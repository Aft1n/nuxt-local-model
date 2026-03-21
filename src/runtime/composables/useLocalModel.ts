import { useRuntimeConfig } from "nuxt/app"
import type { LocalModelPipeline, LocalModelRunner, LocalModelPipelineOptions } from "../types"
import { getLocalModel, loadLocalModel } from "../shared/local-model"
import { resolveModelDefinition, resolveRuntimeConfig } from "../utils"

const workerCache = new Map<string, Promise<LocalModelRunner>>()

export async function useLocalModel(name: string, callOptions: LocalModelPipelineOptions = {}) {
  const runtimeConfig = resolveRuntimeConfig(useRuntimeConfig().public.localModel as any)
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
          callOptions,
          runtimeConfig,
        ).catch((error) => {
          workerCache.delete(key)
          throw error
        }),
      )
    }
    return workerCache.get(key) as Promise<LocalModelRunner>
  }

  if (process.server) {
    return getLocalModel(name, callOptions) as Promise<LocalModelPipeline | LocalModelRunner>
  }

  return loadLocalModel(name, runtimeConfig, callOptions)
}

function createBrowserWorkerRunner(
  id: string,
  task: string,
  model: string,
  options: Record<string, unknown>,
  cacheDir: string,
  callOptions: Record<string, unknown>,
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>,
): Promise<LocalModelRunner> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../worker/model.worker.ts", import.meta.url), { type: "module" })
    const pendingRuns = new Map<
      string,
      {
        resolve: (value: unknown) => void
        reject: (reason?: unknown) => void
      }
    >()
    let settled = false

    const failPendingRuns = (reason: string) => {
      for (const [, pending] of pendingRuns) {
        pending.reject(new Error(reason))
      }
      pendingRuns.clear()
    }

    const runner: LocalModelRunner = Object.assign(
      async (...args: any[]) =>
        new Promise((runResolve, runReject) => {
          const requestId = `${id}:${Date.now()}:${Math.random().toString(16).slice(2)}`
          pendingRuns.set(requestId, { resolve: runResolve, reject: runReject })
          worker.postMessage({ type: "run", id, requestId, args: [args[0], callOptions] })
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
        settled = true
        workerCache.delete(id)
        reject(new Error(event.data.error || "Worker model initialization failed"))
        return
      }

      settled = true
      resolve(runner)
    }

    worker.addEventListener("message", handleInit)
    worker.onerror = (error) => {
      failPendingRuns("Browser worker crashed")
      workerCache.delete(id)
      if (!settled) {
        settled = true
        reject(error)
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
      allowLocalModels: runtimeConfig.allowLocalModels,
    })
  })
}
