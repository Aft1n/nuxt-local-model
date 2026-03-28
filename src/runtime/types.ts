import type { AllTasks as TransformersAllTasks, PipelineType as TransformersPipelineType, PretrainedModelOptions } from "@huggingface/transformers"

export type LocalModelSupportedRuntime = "node" | "bun" | "deno"
export type LocalModelRuntime = "auto" | LocalModelSupportedRuntime
export type LocalModelKnownTask = TransformersPipelineType
export type LocalModelTask = LocalModelKnownTask | (string & {})

type LocalModelCallable = (...args: unknown[]) => Promise<unknown>

export type LocalModelPipeline = LocalModelCallable & {
  dispose?: () => Promise<void> | void
}
export type LocalModelPipelineLoadOptions = PretrainedModelOptions
export type LocalModelPrewarmTargets = boolean | string[]

type NuxtLocalModelRegistrySentinel = "__nuxt_local_model_registry__"

declare global {
  interface NuxtLocalModelRegistry {
    __nuxt_local_model_registry__?: never
  }
}

type ConfiguredLocalModelName = Exclude<keyof NuxtLocalModelRegistry, NuxtLocalModelRegistrySentinel> & string

type LocalModelTaskCallOptionsMap = {
  "automatic-speech-recognition": NonNullable<Parameters<TransformersAllTasks["automatic-speech-recognition"]>[1]>
  asr: NonNullable<Parameters<TransformersAllTasks["asr"]>[1]>
  "feature-extraction": NonNullable<Parameters<TransformersAllTasks["feature-extraction"]>[1]>
  embeddings: NonNullable<Parameters<TransformersAllTasks["embeddings"]>[1]>
  "fill-mask": NonNullable<Parameters<TransformersAllTasks["fill-mask"]>[1]>
  "sentiment-analysis": NonNullable<Parameters<TransformersAllTasks["sentiment-analysis"]>[1]>
  summarization: NonNullable<Parameters<TransformersAllTasks["summarization"]>[1]>
  "text-classification": NonNullable<Parameters<TransformersAllTasks["text-classification"]>[1]>
  "text-generation": NonNullable<Parameters<TransformersAllTasks["text-generation"]>[1]>
  "text2text-generation": NonNullable<Parameters<TransformersAllTasks["text2text-generation"]>[1]>
  translation: NonNullable<Parameters<TransformersAllTasks["translation"]>[1]>
}

type LocalModelKnownPipeline<TTask extends LocalModelTask> =
  TTask extends LocalModelKnownTask
    ? TransformersAllTasks[TTask]
    : never

export type LocalModelPipelineOptions<TTask extends LocalModelTask = LocalModelTask> =
  TTask extends keyof LocalModelTaskCallOptionsMap
    ? LocalModelTaskCallOptionsMap[TTask]
    : Record<string, unknown>

export type LocalModelResolvedModel<TTask extends LocalModelTask = LocalModelTask> =
  [LocalModelKnownPipeline<TTask>] extends [never]
    ? LocalModelRunner
    : LocalModelKnownPipeline<TTask>

export type LocalModelName =
  ConfiguredLocalModelName extends never
    ? string
    : ConfiguredLocalModelName | (string & {})

export type LocalModelTaskForName<TName extends string> =
  TName extends ConfiguredLocalModelName
    ? NuxtLocalModelRegistry[TName] & LocalModelTask
    : LocalModelTask

export type LocalModelCallOptionsForName<TName extends string> =
  ConfiguredLocalModelName extends never
    ? Record<string, unknown>
    : TName extends ConfiguredLocalModelName
      ? LocalModelPipelineOptions<NuxtLocalModelRegistry[TName] & LocalModelTask>
      : Record<string, unknown>

export type LocalModelResolvedModelForName<TName extends string> =
  ConfiguredLocalModelName extends never
    ? LocalModelRunner
    : TName extends ConfiguredLocalModelName
      ? LocalModelResolvedModel<NuxtLocalModelRegistry[TName] & LocalModelTask>
      : LocalModelRunner

export interface LocalModelDefinition<TTask extends LocalModelTask = LocalModelTask> {
  task: TTask
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
  serverPrewarm?: LocalModelPrewarmTargets
  serverWorker?: boolean
  browserWorker?: boolean
  browserPrewarm?: LocalModelPrewarmTargets
  models?: TModels
}

export type LocalModelConfig<TModels extends LocalModelModelRegistry = LocalModelModelRegistry> = LocalModelRuntimeConfig<TModels>

export type LocalModelRunner = LocalModelCallable & {
  dispose?: () => Promise<void> | void
}

export {}
