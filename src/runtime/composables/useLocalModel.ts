import { pipeline, env } from "@huggingface/transformers"
import { useRuntimeConfig } from "#app"
import type { LocalModelPipeline, LocalModelRunner, LocalModelUseOptions } from "../types"
import { resolveModelDefinition, resolveRuntimeConfig, resolveCacheDir } from "../utils"

const pipelineCache = new Map<string, Promise<LocalModelPipeline>>()
const workerCache = new Map<string, Promise<LocalModelRunner>>()

function cacheKey(name: string, task: string, model: string, cacheDir: string) {
  return [name, task, model, cacheDir].join("::")
}

export async function useLocalModel(name: string, useOptions: LocalModelUseOptions = {}) {
  const runtimeConfig = resolveRuntimeConfig(useRuntimeConfig().public.localModel as any)
  const definition = resolveModelDefinition(name, runtimeConfig, useOptions)
  const cacheDir = resolveCacheDir(runtimeConfig.cacheDir)
  const useBrowserWorker = useOptions.browserWorker ?? runtimeConfig.browserWorker ?? false
  const useServerWorker = runtimeConfig.serverWorker ?? false

  env.cacheDir = cacheDir
  env.allowRemoteModels = runtimeConfig.allowRemoteModels
  env.allowLocalModels = runtimeConfig.allowLocalModels
  env.localModelPath = runtimeConfig.localModelPath

  const key = cacheKey(name, definition.task, definition.model, cacheDir)
  const { useWorker: _useWorker, ...pipelineOptions } = definition.options || {}

  if (process.client && useBrowserWorker) {
    if (!workerCache.has(key)) {
      console.info(`[nuxt-local-model] starting browser worker for "${name}" -> ${definition.model}`)
      workerCache.set(key, createBrowserWorkerRunner(key, definition.task, definition.model, pipelineOptions, cacheDir, runtimeConfig))
    } else {
      console.info(`[nuxt-local-model] reusing browser worker for "${name}" -> ${definition.model}`)
    }
    return workerCache.get(key) as Promise<LocalModelRunner>
  }

  if (process.server && useServerWorker) {
    if (!workerCache.has(key)) {
      console.info(`[nuxt-local-model] starting server worker for "${name}" -> ${definition.model}`)
      workerCache.set(key, createServerWorkerRunner(key, definition.task, definition.model, pipelineOptions, cacheDir, runtimeConfig))
    } else {
      console.info(`[nuxt-local-model] reusing server worker for "${name}" -> ${definition.model}`)
    }
    return workerCache.get(key) as Promise<LocalModelRunner>
  }

  if (!pipelineCache.has(key)) {
    console.info(`[nuxt-local-model] loading pipeline for "${name}" -> ${definition.model} (${definition.task})`)
    pipelineCache.set(key, pipeline(definition.task as any, definition.model, pipelineOptions) as Promise<LocalModelPipeline>)
  } else {
    console.info(`[nuxt-local-model] reusing pipeline for "${name}" -> ${definition.model}`)
  }

  return pipelineCache.get(key) as Promise<LocalModelPipeline>
}

function createServerWorkerRunner(
  id: string,
  task: string,
  model: string,
  options: Record<string, unknown>,
  cacheDir: string,
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>,
): Promise<LocalModelRunner> {
  return new Promise((resolve, reject) => {
    void import("node:worker_threads")
      .then(({ Worker: NodeWorker }) => {
        const worker = new NodeWorker(new URL("../server/worker.ts", import.meta.url), {
          workerData: {
            id,
            task,
            model,
            options,
            cacheDir,
            localModelPath: runtimeConfig.localModelPath,
            allowRemoteModels: runtimeConfig.allowRemoteModels,
            allowLocalModels: runtimeConfig.allowLocalModels,
          },
        })

        const runner: LocalModelRunner = Object.assign(
          async (...args: any[]) =>
            new Promise((runResolve, runReject) => {
              const handleMessage = (message: { id: string; ok: boolean; result?: unknown; error?: string; type: string }) => {
                if (message.id !== id || message.type !== "run") return
                worker.off("message", handleMessage)
                if (message.ok) runResolve(message.result)
                else runReject(new Error(message.error || "Server worker model execution failed"))
              }
              worker.on("message", handleMessage)
              worker.postMessage({ type: "run", args })
            }),
          {
            dispose: () => worker.terminate(),
          },
        )

        worker.once("error", reject)
        resolve(runner)
      })
      .catch(reject)
  })
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
    const worker = new Worker(new URL("../worker/model.worker.ts", import.meta.url), { type: "module" })

    const handleInit = (event: MessageEvent<{ id: string; ok: boolean; error?: string; type: string }>) => {
      if (event.data.id !== id || event.data.type !== "init") return
      worker.removeEventListener("message", handleInit)
      if (!event.data.ok) {
        reject(new Error(event.data.error || "Worker model initialization failed"))
      }
    }

    worker.addEventListener("message", handleInit)
    worker.onerror = (error) => reject(error)

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

    const runner: LocalModelRunner = Object.assign(
      async (...args: any[]) =>
        new Promise((runResolve, runReject) => {
          const handleMessage = (event: MessageEvent<{ id: string; ok: boolean; result?: unknown; error?: string; type: string }>) => {
            if (event.data.id !== id || event.data.type !== "run") return
            worker.removeEventListener("message", handleMessage)
            if (event.data.ok) runResolve(event.data.result)
            else runReject(new Error(event.data.error || "Worker model execution failed"))
          }
          worker.addEventListener("message", handleMessage)
          worker.postMessage({ type: "run", id, args })
        }),
      {
        dispose: () => {
          worker.postMessage({ type: "dispose", id })
          worker.terminate()
        },
      },
    )

    resolve(runner)
  })
}
