import type { LocalModelConfig } from "./types"

export function defineLocalModelConfig<const T extends LocalModelConfig>(config: T) {
  return config
}

export type { LocalModelAliases } from "./types"
