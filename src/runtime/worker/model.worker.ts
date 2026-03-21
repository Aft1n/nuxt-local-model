import { env, pipeline } from "@huggingface/transformers"

type InitMessage = {
  type: "init"
  id: string
  task: string
  model: string
  options?: Record<string, unknown>
  cacheDir?: string
  localModelPath?: string
  allowRemoteModels?: boolean
  allowLocalModels?: boolean
}

type RunMessage = {
  type: "run"
  id: string
  args: unknown[]
}

type DisposeMessage = {
  type: "dispose"
  id: string
}

type Message = InitMessage | RunMessage | DisposeMessage

const pipelines = new Map<string, Promise<any>>()

self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data

  try {
    if (message.type === "init") {
      env.cacheDir = message.cacheDir || env.cacheDir
      env.localModelPath = message.localModelPath || env.localModelPath
      env.allowRemoteModels = message.allowRemoteModels ?? true
      env.allowLocalModels = message.allowLocalModels ?? false

      if (!pipelines.has(message.id)) {
        pipelines.set(message.id, pipeline(message.task as any, message.model, message.options || {}))
      }

      self.postMessage({ id: message.id, ok: true, type: "init" })
      return
    }

    if (message.type === "dispose") {
      pipelines.delete(message.id)
      self.postMessage({ id: message.id, ok: true, type: "dispose" })
      return
    }

    const model = pipelines.get(message.id)
    if (!model) throw new Error("Model pipeline is not initialized.")
    const resolved = await model
    const result = await resolved(...message.args)
    self.postMessage({ id: message.id, ok: true, type: "run", result })
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
