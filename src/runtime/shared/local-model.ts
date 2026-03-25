import type { LocalModelPipeline, LocalModelPipelineOptions, LocalModelRuntimeConfig } from "../types"
import {
  applyLocalModelEnvironment,
  canUseServerWorkerForRuntime,
  type InternalLocalModelRuntimeConfig,
  resolveModelDefinition,
  resolveRuntimeConfig,
  type ResolvedLocalModelRuntimeConfig,
} from "../utils"

const modelCache = new Map<string, Promise<LocalModelPipeline>>()
const serverWorkerCache = new Map<string, Promise<LocalModelPipeline>>()
const warnedMessages = new Set<string>()
let onnxBackendPromise: Promise<void> | null = null
const runtimeConfigSymbol = Symbol.for("nuxt-local-model:runtime-config")
type ServerWorkerMessage =
  | {
      id: string
      requestId: string
      ok: boolean
      type: "run"
      result?: unknown
      error?: string
    }
  | {
      id: string
      ok: boolean
      type: "dispose"
      error?: string
    }

function getRuntimeConfigStore(): InternalLocalModelRuntimeConfig | null {
  return ((globalThis as Record<PropertyKey, unknown>)[runtimeConfigSymbol] as InternalLocalModelRuntimeConfig | null) || null
}

function setRuntimeConfigStore(config: InternalLocalModelRuntimeConfig | null) {
  ;(globalThis as Record<PropertyKey, unknown>)[runtimeConfigSymbol] = config
}

function warnOnce(message: string) {
  if (warnedMessages.has(message)) return
  warnedMessages.add(message)
  console.warn(message)
}

function cacheKey(name: string, task: string, model: string, cacheDir: string) {
  return [name, task, model, cacheDir].join("::")
}

async function createPipelineRunner(task: string, model: string, options: Record<string, unknown>) {
  const { pipeline } = await import("@huggingface/transformers")
  const pipelineFactory = pipeline as unknown as (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<LocalModelPipeline>
  return pipelineFactory(task, model, options)
}

async function resolveServerWorkerEntry() {
  const [{ existsSync }, pathMod, urlMod] = await Promise.all([
    import("node:fs"),
    import("node:path"),
    import("node:url"),
  ])

  const baseDir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url))
  const jsEntry = pathMod.resolve(baseDir, "../server/worker.js")
  if (existsSync(jsEntry)) return jsEntry
  return pathMod.resolve(baseDir, "../server/worker.ts")
}

async function canUseServerWorkerRuntime(config: ResolvedLocalModelRuntimeConfig) {
  if (typeof window !== "undefined") return false
  if (!canUseServerWorkerForRuntime(config.runtime)) return false

  try {
    const mod = await import("node:worker_threads")
    return typeof mod.Worker === "function"
  } catch {
    return false
  }
}

async function ensurePreferredOnnxBackend(config: ResolvedLocalModelRuntimeConfig) {
  if (typeof window !== "undefined") return
  if (onnxBackendPromise) return onnxBackendPromise

  onnxBackendPromise = (async () => {
    try {
      const onnxruntimeNodeId = "onnxruntime-node"
      const ort = await import(/* @vite-ignore */ onnxruntimeNodeId)
      const backend = (ort.default ?? ort) as typeof ort
      const symbol = Symbol.for("onnxruntime")
      if (!(symbol in globalThis)) {
        ;(globalThis as Record<PropertyKey, unknown>)[symbol] = backend
      }
    } catch {
      warnOnce(
        `[nuxt-local-model] onnxruntime-node is not available in ${config.runtime}; falling back to the default Transformers.js backend.`,
      )
    }
  })()

  return onnxBackendPromise
}

export function isLocalModelRuntimeConfig(value: unknown): value is LocalModelRuntimeConfig {
  return !!value && typeof value === "object" && ("models" in value || "cacheDir" in value || "runtime" in value)
}

export function setLocalModelRuntimeConfig(config: InternalLocalModelRuntimeConfig | null | undefined) {
  if (config) {
    setRuntimeConfigStore(resolveRuntimeConfig(config))
  }
}

function createServerWorkerRunner(
  name: string,
  task: string,
  model: string,
  options: Record<string, unknown>,
  cacheDir: string,
  runtimeConfig: ResolvedLocalModelRuntimeConfig,
) {
  const key = cacheKey(name, task, model, cacheDir)

  if (!serverWorkerCache.has(key)) {
    const workerPromise = (async () => {
      const workerEntry = runtimeConfig.serverWorkerEntry || await resolveServerWorkerEntry()
      console.info(`🧵 [nuxt-local-model] using server worker for "${name}" (${task} -> ${model}) at ${workerEntry}`)
      const { Worker } = await import("node:worker_threads")
      const worker = new Worker(workerEntry, {
        workerData: {
          id: key,
          task,
          model,
          options,
          cacheDir,
          allowRemoteModels: runtimeConfig.allowRemoteModels,
          allowLocalModels: runtimeConfig.allowLocalModels,
        },
      })

      const pendingRuns = new Map<
        string,
        {
          resolve: (value: unknown) => void
          reject: (reason?: unknown) => void
          timeout: ReturnType<typeof setTimeout>
        }
      >()

      const failPendingRuns = (reason: string) => {
        for (const [, pending] of pendingRuns) {
          clearTimeout(pending.timeout)
          pending.reject(new Error(reason))
        }
        pendingRuns.clear()
      }

      const handleMessage = (message: ServerWorkerMessage) => {
        if (message.id !== key || message.type !== "run") return

        const pending = pendingRuns.get(message.requestId)
        if (!pending) return

        clearTimeout(pending.timeout)
        pendingRuns.delete(message.requestId)

        if (message.ok) {
          pending.resolve(message.result)
          return
        }

        pending.reject(new Error(message.error || "Server worker model execution failed"))
      }

      worker.on("message", handleMessage)
      worker.once("error", (error) => {
        worker.off("message", handleMessage)
        serverWorkerCache.delete(key)
        failPendingRuns(error instanceof Error ? error.message : "Server worker crashed")
      })
      worker.once("exit", (code) => {
        worker.off("message", handleMessage)
        serverWorkerCache.delete(key)
        if (code !== 0) {
          failPendingRuns(`Server worker exited with code ${code}`)
        }
      })

      return Object.assign(
        async (...args: unknown[]) =>
          new Promise((runResolve, runReject) => {
            const requestId = `${key}:${Date.now()}:${Math.random().toString(16).slice(2)}`
            const timeout = setTimeout(() => {
              pendingRuns.delete(requestId)
              runReject(new Error(`Server worker timed out for "${name}"`))
            }, 120000)

            pendingRuns.set(requestId, { resolve: runResolve, reject: runReject, timeout })
            worker.postMessage({ type: "run", requestId, args })
          }),
        {
          dispose: async () => {
            failPendingRuns("Server worker disposed")
            worker.off("message", handleMessage)
            serverWorkerCache.delete(key)
            await worker.terminate()
          },
        },
      ) as LocalModelPipeline
    })().catch((error) => {
      serverWorkerCache.delete(key)
      throw error
    })

    serverWorkerCache.set(key, workerPromise)
  }

  return serverWorkerCache.get(key) as Promise<LocalModelPipeline>
}

export async function loadLocalModel(
  name: string,
  runtimeConfig: LocalModelRuntimeConfig,
  callOptions: LocalModelPipelineOptions = {},
) {
  const resolvedConfig = resolveRuntimeConfig(runtimeConfig)
  await ensurePreferredOnnxBackend(resolvedConfig)

  const definition = resolveModelDefinition(name, resolvedConfig)
  const cacheDir = resolvedConfig.cacheDir

  if (typeof window === "undefined" && resolvedConfig.serverWorker) {
    if (!(await canUseServerWorkerRuntime(resolvedConfig))) {
      warnOnce(
        `[nuxt-local-model] serverWorker is enabled for ${resolvedConfig.runtime}, but worker threads are not available. Falling back to the main server thread.`,
      )
    } else {
      return createServerWorkerRunner(
        name,
        definition.task,
        definition.model,
        definition.options || {},
        cacheDir,
        resolvedConfig,
      )
    }
  }

  await applyLocalModelEnvironment({
    cacheDir,
    allowRemoteModels: resolvedConfig.allowRemoteModels,
    allowLocalModels: typeof window === "undefined" ? resolvedConfig.allowLocalModels : false,
  })

  const key = cacheKey(name, definition.task, definition.model, cacheDir)

  if (!modelCache.has(key)) {
    const modelPromise = (async () => {
      const loaded = await createPipelineRunner(definition.task, definition.model, definition.options || {})

      return Object.assign(
        async (...args: unknown[]) => {
          const input = args[0]
          const runtimeCallOptions = (args[1] as Record<string, unknown> | undefined) || {}
          return loaded(input, {
            ...(callOptions as Record<string, unknown>),
            ...runtimeCallOptions,
          })
        },
        {
          dispose: async () => {
            await loaded.dispose?.()
            modelCache.delete(key)
          },
        },
      ) as LocalModelPipeline
    })().catch((error) => {
      modelCache.delete(key)
      throw error
    })

    modelCache.set(key, modelPromise)
  }

  return modelCache.get(key) as Promise<LocalModelPipeline>
}

export async function getLocalModel(name: string, callOptions: LocalModelPipelineOptions = {}) {
  const runtimeConfig = getRuntimeConfigStore() || resolveRuntimeConfig(undefined)
  return loadLocalModel(name, runtimeConfig, callOptions)
}
