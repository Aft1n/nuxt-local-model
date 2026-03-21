import { parentPort, workerData } from "node:worker_threads"
import { isMainThread, threadId } from "node:worker_threads"
import { pipeline } from "@huggingface/transformers"
import { serializeWorkerResult } from "../shared/serialize"
import { applyLocalModelEnvironment } from "../utils"

const { id, task, model, options, cacheDir, allowRemoteModels, allowLocalModels } = workerData as {
  id: string
  task: string
  model: string
  options?: Record<string, unknown>
  cacheDir?: string
  allowRemoteModels?: boolean
  allowLocalModels?: boolean
}

applyLocalModelEnvironment({
  cacheDir: cacheDir || "./.ai-models",
  allowRemoteModels: allowRemoteModels ?? true,
  allowLocalModels: allowLocalModels ?? true,
})

console.info(
  `🧵 [nuxt-local-model] server worker ready threadId=${threadId} mainThread=${isMainThread} cacheDir=${cacheDir || "./.ai-models"}`,
)

const modelPromise = pipeline(task as any, model, options || {})

parentPort?.on("message", async (message: { type: "run"; requestId: string; args: unknown[] } | { type: "dispose" }) => {
  try {
    if (message.type === "dispose") {
      parentPort?.postMessage({ id, ok: true, type: "dispose" })
      return
    }

    const runner = await modelPromise
    const result = await runner(...message.args)
    parentPort?.postMessage({ id, requestId: message.requestId, ok: true, type: "run", result: serializeWorkerResult(result) })
  } catch (error) {
    parentPort?.postMessage({
      id,
      requestId: message.type === "run" ? message.requestId : undefined,
      ok: false,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
