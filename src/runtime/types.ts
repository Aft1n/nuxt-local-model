import type { Pipeline } from "@huggingface/transformers"

export type LocalModelTask =
  | "feature-extraction"
  | "text-classification"
  | "text-generation"
  | "fill-mask"
  | "automatic-speech-recognition"
  | (string & {})

export type LocalModelPipeline = Pipeline

export interface LocalModelDefinition {
  task: LocalModelTask
  model: string
  options?: Record<string, unknown>
}

export interface LocalModelRuntimeConfig {
  cacheDir?: string
  allowRemoteModels?: boolean
  allowLocalModels?: boolean
  localModelPath?: string
  defaultTask?: LocalModelTask
  serverWorker?: boolean
  browserWorker?: boolean
  models?: Record<string, LocalModelDefinition>
}

export interface LocalModelUseOptions extends Record<string, unknown> {
  browserWorker?: boolean
}

export type LocalModelRunner = ((...args: any[]) => Promise<unknown>) & {
  dispose?: () => Promise<void> | void
}
