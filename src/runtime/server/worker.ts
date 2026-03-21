import { parentPort, workerData } from "node:worker_threads"
import { env, pipeline } from "@huggingface/transformers"

const { id, task, model, options, cacheDir, localModelPath, allowRemoteModels, allowLocalModels } = workerData as {
  id: string
  task: string
  model: string
  options?: Record<string, unknown>
  cacheDir?: string
  localModelPath?: string
  allowRemoteModels?: boolean
  allowLocalModels?: boolean
}

env.cacheDir = cacheDir || env.cacheDir
env.localModelPath = localModelPath || env.localModelPath
env.allowRemoteModels = allowRemoteModels ?? true
env.allowLocalModels = allowLocalModels ?? true

const modelPromise = pipeline(task as any, model, options || {})

parentPort?.on("message", async (message: { type: "run"; args: unknown[] } | { type: "dispose" }) => {
  try {
    if (message.type === "dispose") {
      parentPort?.postMessage({ id, ok: true, type: "dispose" })
      process.exit(0)
      return
    }

    const runner = await modelPromise
    const result = await runner(...message.args)
    parentPort?.postMessage({ id, ok: true, type: "run", result })
  } catch (error) {
    parentPort?.postMessage({
      id,
      ok: false,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
