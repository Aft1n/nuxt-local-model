export type LocalModelSupportedRuntime = "node" | "bun" | "deno"
export type LocalModelRuntime = "auto" | LocalModelSupportedRuntime

export type LocalModelTask =
  | "feature-extraction"
  | "text-classification"
  | "text-generation"
  | "fill-mask"
  | "automatic-speech-recognition"
  | (string & {})

type LocalModelCallable = (...args: unknown[]) => Promise<unknown>

export type LocalModelPipeline = LocalModelCallable & {
  dispose?: () => Promise<void> | void
}
export type LocalModelPipelineOptions = Record<string, unknown>
export type LocalModelPipelineLoadOptions = Record<string, unknown>
export type LocalModelPrewarmTargets = boolean | string[]

export interface LocalModelDefinition {
  task: LocalModelTask
  model: string
  options?: LocalModelPipelineLoadOptions
}

export type LocalModelModelRegistry = Record<string, LocalModelDefinition>

export type LocalModelAliases<T extends Pick<LocalModelRuntimeConfig, "models">> = keyof NonNullable<T["models"]> & string

export interface LocalModelRuntimeConfig<TModels extends LocalModelModelRegistry = LocalModelModelRegistry> {
  runtime?: LocalModelRuntime
  cacheDir?: string
  allowRemoteModels?: boolean
  allowLocalModels?: boolean
  defaultTask?: LocalModelTask
  serverWorker?: boolean
  browserWorker?: boolean
  browserPrewarm?: LocalModelPrewarmTargets
  models?: TModels
}

export type LocalModelConfig<TModels extends LocalModelModelRegistry = LocalModelModelRegistry> = LocalModelRuntimeConfig<TModels>

export type LocalModelRunner = LocalModelCallable & {
  dispose?: () => Promise<void> | void
}
