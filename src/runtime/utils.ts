import type { LocalModelDefinition, LocalModelRuntimeConfig, LocalModelUseOptions } from "./types"

export function resolveCacheDir(cacheDir?: string) {
  if (cacheDir?.trim()) return cacheDir.trim()
  return process.env.NUXT_LOCAL_MODEL_CACHE_DIR?.trim() || "./.ai-models"
}

export function resolveRuntimeConfig(config?: LocalModelRuntimeConfig): Required<Pick<LocalModelRuntimeConfig, "allowRemoteModels" | "allowLocalModels">> & LocalModelRuntimeConfig {
  return {
    allowRemoteModels: config?.allowRemoteModels ?? true,
    allowLocalModels: config?.allowLocalModels ?? false,
    localModelPath: config?.localModelPath ?? "/models/",
    cacheDir: resolveCacheDir(config?.cacheDir),
    defaultTask: config?.defaultTask ?? "feature-extraction",
    serverWorker: config?.serverWorker ?? false,
    browserWorker: config?.browserWorker ?? false,
    models: config?.models ?? {},
  }
}

export function resolveModelDefinition(
  name: string,
  runtimeConfig: LocalModelRuntimeConfig | undefined,
  useOptions?: Record<string, unknown>,
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
      ...(useOptions || {}),
    },
  }
}
