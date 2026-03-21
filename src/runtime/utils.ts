import { env } from "@huggingface/transformers"
import type {
  LocalModelDefinition,
  LocalModelModelRegistry,
  LocalModelPipelineLoadOptions,
  LocalModelPipelineOptions,
  LocalModelRuntime,
  LocalModelRuntimeConfig,
  LocalModelSupportedRuntime,
} from "./types"

export interface InternalLocalModelRuntimeConfig extends LocalModelRuntimeConfig {
  serverWorkerEntry?: string
}

export interface ResolvedLocalModelRuntimeConfig extends Omit<InternalLocalModelRuntimeConfig, "runtime" | "models"> {
  runtime: LocalModelSupportedRuntime
  models: LocalModelModelRegistry
  cacheDir: string
  allowRemoteModels: boolean
  allowLocalModels: boolean
}

interface SplitUseOptionsResult {
  loadOptions: LocalModelPipelineLoadOptions
}

function readEnvValue(name: string) {
  const processValue = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]
  if (typeof processValue === "string" && processValue.trim()) {
    return processValue.trim()
  }

  const deno = globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }
  try {
    const denoValue = deno.Deno?.env?.get?.(name)
    if (typeof denoValue === "string" && denoValue.trim()) {
      return denoValue.trim()
    }
  } catch {
    // Deno.env can throw when env access is not allowed.
  }

  return undefined
}

export function detectLocalModelRuntime(runtime: LocalModelRuntime = "auto"): LocalModelSupportedRuntime {
  if (runtime !== "auto") {
    return runtime
  }

  const bun = globalThis as { Bun?: unknown; process?: { versions?: { bun?: string } } }
  if (bun.Bun || bun.process?.versions?.bun) {
    return "bun"
  }

  const deno = globalThis as { Deno?: { version?: { deno?: string } } }
  if (deno.Deno?.version?.deno) {
    return "deno"
  }

  return "node"
}

export function resolveCacheDir(cacheDir?: string) {
  if (cacheDir?.trim()) return cacheDir.trim()
  return readEnvValue("NUXT_LOCAL_MODEL_CACHE_DIR") || "./.ai-models"
}

export function resolveRuntimeConfig(config?: InternalLocalModelRuntimeConfig): ResolvedLocalModelRuntimeConfig {
  return {
    runtime: detectLocalModelRuntime(config?.runtime ?? "auto"),
    allowRemoteModels: config?.allowRemoteModels ?? true,
    allowLocalModels: config?.allowLocalModels ?? true,
    cacheDir: resolveCacheDir(config?.cacheDir),
    defaultTask: config?.defaultTask ?? "feature-extraction",
    serverWorker: config?.serverWorker ?? false,
    serverWorkerEntry: config?.serverWorkerEntry,
    browserWorker: config?.browserWorker ?? false,
    models: config?.models ?? {},
  }
}

export function applyLocalModelEnvironment(config: Pick<ResolvedLocalModelRuntimeConfig, "cacheDir" | "allowRemoteModels" | "allowLocalModels">) {
  env.cacheDir = resolveCacheDir(config.cacheDir)
  env.localModelPath = env.cacheDir
  env.allowRemoteModels = config.allowRemoteModels
  env.allowLocalModels = config.allowLocalModels
}

export function canUseServerWorkerForRuntime(runtime: LocalModelSupportedRuntime) {
  return runtime === "node" || runtime === "bun" || runtime === "deno"
}

export function resolveModelDefinition(
  name: string,
  runtimeConfig: InternalLocalModelRuntimeConfig | undefined,
  loadOptions?: LocalModelPipelineLoadOptions,
): LocalModelDefinition {
  const resolved = resolveRuntimeConfig(runtimeConfig)
  const registryEntry = resolved.models?.[name]

  if (!registryEntry) {
    throw new Error(`Local model "${name}" is not defined in nuxt.config.`)
  }

  return {
    task: registryEntry?.task || resolved.defaultTask || "feature-extraction",
    model: registryEntry?.model || name,
    options: {
      ...(registryEntry?.options || {}),
      ...loadOptions,
    },
  }
}
