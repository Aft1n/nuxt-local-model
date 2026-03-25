import type { LocalModelPipeline, LocalModelTask } from "../types"
import { serializeWorkerResult } from "../shared/serialize"
import { applyLocalModelEnvironment } from "../utils"

type InitMessage = {
  type: "init"
  id: string
  task: LocalModelTask
  model: string
  options?: Record<string, unknown>
  cacheDir?: string
  allowRemoteModels?: boolean
  allowLocalModels?: boolean
}

type RunMessage = {
  type: "run"
  id: string
  requestId: string
  args: unknown[]
}

type DisposeMessage = {
  type: "dispose"
  id: string
}

type Message = InitMessage | RunMessage | DisposeMessage

const pipelines = new Map<string, Promise<LocalModelPipeline>>()
const globalScope = self as typeof self & {
  __nuxtLocalModelFetchPatched?: boolean
  __nuxtLocalModelActiveId?: string | null
}
const currentFetch = typeof globalScope.fetch === "function" ? globalScope.fetch : null
const originalFetch = currentFetch?.bind(globalScope) ?? null

if (currentFetch && originalFetch && !globalScope.__nuxtLocalModelFetchPatched) {
  globalScope.__nuxtLocalModelFetchPatched = true
  globalScope.fetch = Object.assign(
    (async (...args: Parameters<typeof fetch>) => {
      const request = args[0]
      const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request?.url || ""
      const loggable = /huggingface|xenova|onnx|\.onnx|\.safetensors|\.json/i.test(url)

      if (loggable) {
        globalScope.postMessage({
          id: globalScope.__nuxtLocalModelActiveId,
          type: "debug",
          message: "fetch-start",
          meta: { url },
        })
      }

      try {
        const response = await originalFetch(...args)
        if (loggable) {
          globalScope.postMessage({
            id: globalScope.__nuxtLocalModelActiveId,
            type: "debug",
            message: "fetch-end",
            meta: { url, status: response.status, ok: response.ok },
          })
        }
        return response
      } catch (error) {
        if (loggable) {
          globalScope.postMessage({
            id: globalScope.__nuxtLocalModelActiveId,
            type: "debug",
            message: "fetch-error",
            meta: { url, error: error instanceof Error ? error.message : String(error) },
          })
        }
        throw error
      }
    }) as typeof fetch,
    currentFetch,
  )
}

self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data

  try {
    if (message.type === "init") {
      globalScope.__nuxtLocalModelActiveId = message.id
      globalScope.postMessage({
        id: message.id,
        type: "debug",
        message: "init-start",
        meta: { task: message.task, model: message.model },
      })

      await applyLocalModelEnvironment({
        cacheDir: message.cacheDir || "./.ai-models",
        allowRemoteModels: message.allowRemoteModels ?? true,
        allowLocalModels: message.allowLocalModels ?? false,
      })

      if (!pipelines.has(message.id)) {
        const { pipeline } = await import("@huggingface/transformers")
        const pipelineFactory = pipeline as unknown as (
          task: LocalModelTask,
          model: string,
          options?: Record<string, unknown>,
        ) => Promise<LocalModelPipeline>
        pipelines.set(message.id, pipelineFactory(message.task, message.model, message.options || {}))
      }

      await pipelines.get(message.id)

      globalScope.postMessage({
        id: message.id,
        type: "debug",
        message: "pipeline-ready",
        meta: { task: message.task, model: message.model },
      })

      self.postMessage({ id: message.id, ok: true, type: "init" })
      return
    }

    if (message.type === "dispose") {
      pipelines.delete(message.id)
      if (globalScope.__nuxtLocalModelActiveId === message.id) {
        globalScope.__nuxtLocalModelActiveId = null
      }
      self.postMessage({ id: message.id, ok: true, type: "dispose" })
      return
    }

    const model = pipelines.get(message.id)
    if (!model) throw new Error("Model pipeline is not initialized.")
    const resolved = await model
    const result = await resolved(...message.args)
    self.postMessage({ id: message.id, requestId: message.requestId, ok: true, type: "run", result: serializeWorkerResult(result) })
  } catch (error) {
    self.postMessage({
      id: message.id,
      requestId: message.type === "run" ? message.requestId : undefined,
      ok: false,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
