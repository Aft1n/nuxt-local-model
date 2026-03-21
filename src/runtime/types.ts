import { pipeline } from "@huggingface/transformers"
import type { Pipeline } from "@huggingface/transformers"

export type LocalModelSupportedRuntime = "node" | "bun" | "deno"
export type LocalModelRuntime = "auto" | LocalModelSupportedRuntime

export type LocalModelTask =
  | "feature-extraction"
  | "text-classification"
  | "text-generation"
  | "fill-mask"
  | "automatic-speech-recognition"
  | (string & {})

export type LocalModelPipeline = Pipeline
export type LocalModelPipelineOptions = NonNullable<Parameters<Pipeline>[1]>
export type LocalModelPipelineLoadOptions = NonNullable<Parameters<typeof pipeline>[2]>

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
  models?: TModels
}

export type LocalModelConfig<TModels extends LocalModelModelRegistry = LocalModelModelRegistry> = LocalModelRuntimeConfig<TModels>

export type LocalModelRunner = ((...args: any[]) => Promise<unknown>) & {
  dispose?: () => Promise<void> | void
}
