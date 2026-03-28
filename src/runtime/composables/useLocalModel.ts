import { useRuntimeConfig } from "nuxt/app"
import type {
  LocalModelCallOptionsForName,
  LocalModelName,
  LocalModelPipeline,
  LocalModelResolvedModelForName,
  LocalModelRunner,
} from "../types"
import { type InternalLocalModelRuntimeConfig, resolveModelDefinition, resolveRuntimeConfig } from "../utils"

const workerCache = new Map<string, Promise<LocalModelRunner>>()
const BROWSER_WORKER_INIT_TIMEOUT_MS = 45000
// Use the concrete built worker filename so consuming apps emit the worker asset
// correctly when this module is imported from its published dist output.
const BROWSER_WORKER_ENTRY = "../worker/model.worker.js"

function formatWorkerError(error: unknown) {
  if (error instanceof Error) return error.message

  if (typeof ErrorEvent !== "undefined" && error instanceof ErrorEvent) {
    const parts = [error.message, error.filename, error.lineno ? `:${error.lineno}` : "", error.colno ? `:${error.colno}` : ""]
      .filter(Boolean)
      .join("")
    return parts || "Browser worker error event"
  }

  if (typeof error === "object" && error) {
    const candidate = error as { message?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown; type?: unknown }
    const parts = [
      typeof candidate.message === "string" ? candidate.message : "",
      typeof candidate.filename === "string" ? candidate.filename : "",
      typeof candidate.lineno === "number" ? `:${candidate.lineno}` : "",
      typeof candidate.colno === "number" ? `:${candidate.colno}` : "",
      typeof candidate.type === "string" ? ` (${candidate.type})` : "",
    ].filter(Boolean)
    if (parts.length) return parts.join("")
  }

  return String(error)
}

export async function useLocalModel<TName extends LocalModelName>(
  name: TName,
  callOptions: LocalModelCallOptionsForName<TName> = {} as LocalModelCallOptionsForName<TName>,
) {
  const publicRuntimeConfig = useRuntimeConfig().public as { localModel?: InternalLocalModelRuntimeConfig }
  const runtimeConfig = resolveRuntimeConfig(publicRuntimeConfig.localModel)
  const cacheDir = runtimeConfig.cacheDir
  const useBrowserWorker = runtimeConfig.browserWorker ?? false
  const definition = resolveModelDefinition(name, runtimeConfig)
  const key = [name, definition.task, definition.model, cacheDir].join("::")
  const pipelineOptions = definition.options || {}

  if (process.client && useBrowserWorker) {
    if (!workerCache.has(key)) {
      workerCache.set(
        key,
        createBrowserWorkerRunner(
          key,
          definition.task,
          definition.model,
          pipelineOptions,
          cacheDir,
          runtimeConfig,
        ).catch((error) => {
          workerCache.delete(key)
          throw error
        }),
      )
    }

    return (workerCache.get(key) as Promise<LocalModelRunner>).then((runner) =>
      Object.assign(
        async (...args: unknown[]) => {
          const runtimeCallOptions = {
            ...callOptions,
            ...((args[1] as Record<string, unknown> | undefined) || {}),
          }
          return runner(args[0], runtimeCallOptions)
        },
        {
          dispose: runner.dispose ? async () => runner.dispose?.() : undefined,
        },
      ) as LocalModelResolvedModelForName<TName>,
    )
  }

  if (process.server) {
    const { getLocalModel } = await import("../shared/local-model")
    return getLocalModel(name, callOptions) as Promise<LocalModelResolvedModelForName<TName>>
  }

  const { loadLocalModel } = await import("../shared/local-model")
  return loadLocalModel(name, runtimeConfig, callOptions) as Promise<LocalModelResolvedModelForName<TName>>
}

export async function prewarmLocalModel<TName extends LocalModelName>(
  name: TName,
  callOptions: LocalModelCallOptionsForName<TName> = {} as LocalModelCallOptionsForName<TName>,
) {
  return useLocalModel(name, callOptions)
}

function createBrowserWorkerRunner(
  id: string,
  task: string,
  model: string,
  options: Record<string, unknown>,
  cacheDir: string,
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>,
): Promise<LocalModelRunner> {
  return new Promise((resolve, reject) => {
    // Keep this extensionless so source-mode consumers resolve the `.ts` worker
    // while the published package resolves the compiled `.js` worker.
    const worker = new Worker(new URL(BROWSER_WORKER_ENTRY, import.meta.url), { type: "module" })
    const pendingRuns = new Map<
      string,
      {
        resolve: (value: unknown) => void
        reject: (reason?: unknown) => void
      }
    >()
    let settled = false
    const initTimeout = setTimeout(() => {
      if (settled) return
      settled = true
      workerCache.delete(id)
      worker.terminate()
      reject(new Error(`Browser worker model initialization timed out after ${BROWSER_WORKER_INIT_TIMEOUT_MS}ms`))
    }, BROWSER_WORKER_INIT_TIMEOUT_MS)

    const failPendingRuns = (reason: string) => {
      for (const [, pending] of pendingRuns) {
        pending.reject(new Error(reason))
      }
      pendingRuns.clear()
    }

    const runner: LocalModelRunner = Object.assign(
      async (...args: unknown[]) =>
        new Promise((runResolve, runReject) => {
          const requestId = `${id}:${Date.now()}:${Math.random().toString(16).slice(2)}`
          pendingRuns.set(requestId, { resolve: runResolve, reject: runReject })
          const runOptions = (args[1] as Record<string, unknown> | undefined) || {}
          worker.postMessage({ type: "run", id, requestId, args: [args[0], runOptions] })
        }),
      {
        dispose: () => {
          failPendingRuns("Browser worker disposed")
          workerCache.delete(id)
          worker.removeEventListener("message", handleRun)
          worker.postMessage({ type: "dispose", id })
          worker.terminate()
        },
      },
    )

    const handleInit = (event: MessageEvent<{ id: string; ok: boolean; error?: string; type: string }>) => {
      if (event.data.id !== id || event.data.type !== "init") return
      worker.removeEventListener("message", handleInit)
      if (!event.data.ok) {
        clearTimeout(initTimeout)
        settled = true
        workerCache.delete(id)
        reject(new Error(event.data.error || "Worker model initialization failed"))
        return
      }

      clearTimeout(initTimeout)
      settled = true
      resolve(runner)
    }

    worker.addEventListener("message", handleInit)
    worker.addEventListener("message", (event: MessageEvent<{ id?: string; type?: string; message?: string; meta?: unknown }>) => {
      if (event.data?.id !== id || event.data?.type !== "debug") return
      console.log(`[nuxt-local-model] [browser-worker:${id}] ${event.data.message || "debug"}`, event.data.meta ?? "")
    })
    worker.addEventListener("messageerror", (event) => {
      console.error(`[nuxt-local-model] [browser-worker:${id}] messageerror`, event)
    })
    worker.onerror = (error) => {
      clearTimeout(initTimeout)
      console.error(`[nuxt-local-model] [browser-worker:${id}] error`, error)
      failPendingRuns("Browser worker crashed")
      workerCache.delete(id)
      if (!settled) {
        settled = true
        reject(new Error(formatWorkerError(error)))
      }
    }

    const handleRun = (event: MessageEvent<{ id: string; requestId?: string; ok: boolean; result?: unknown; error?: string; type: string }>) => {
      if (event.data.id !== id || event.data.type !== "run" || !event.data.requestId) return
      const pending = pendingRuns.get(event.data.requestId)
      if (!pending) return
      pendingRuns.delete(event.data.requestId)
      if (event.data.ok) pending.resolve(event.data.result)
      else pending.reject(new Error(event.data.error || "Worker model execution failed"))
    }

    worker.addEventListener("message", handleRun)

    worker.postMessage({
      type: "init",
      id,
      task,
      model,
      options,
      cacheDir,
      allowRemoteModels: runtimeConfig.allowRemoteModels,
      allowLocalModels: false,
    })
  })
}
