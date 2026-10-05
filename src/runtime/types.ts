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

// ---------------------------------------------------------------------------
// Decision models (Jev-style typed judgements, executed locally over ONNX)
// ---------------------------------------------------------------------------

export type DecisionModelState = string | Record<string, unknown> | unknown[]

export interface DecisionNoulQuestion {
  type: "noul"
  instructions: string
  /** Meanings for the two outcomes; defaults to generic Yes/No phrasing. */
  criteria?: { true?: string, false?: string, yes?: string, no?: string }
}
export interface DecisionChoiceQuestion {
  type: "choice"
  instructions: string
  criteria: Record<string, string>
}

export interface DecisionScoreQuestion {
  type: "score"
  instructions: string
  criteria: string[]
}

export type DecisionQuestion = DecisionNoulQuestion | DecisionChoiceQuestion | DecisionScoreQuestion
export type DecisionQuestionMap = Record<string, DecisionQuestion>

export interface DecisionAnswerBase {
  /** 0..1. Present for `choice` and `score`, where the answer is a distribution. */
  confidence?: number
  /** Per-option/per-level probabilities. */
  probabilities?: Record<string, number>
}

export interface DecisionNoulAnswer extends DecisionAnswerBase {
  type: "noul"
  noul: number
}

export interface DecisionChoiceAnswer extends DecisionAnswerBase {
  type: "choice"
  choice: string
  probabilities: Record<string, number>
  confidence?: number
}

export interface DecisionScoreAnswer extends DecisionAnswerBase {
  type: "score"
  score: number
  probabilities: Record<string, number>
  confidence?: number
  /** String level index -> level label, mirroring the question's criteria. */
  legend?: Record<string, string>
}

export type DecisionAnswer = DecisionNoulAnswer | DecisionChoiceAnswer | DecisionScoreAnswer
export type DecisionAnswers = Record<string, DecisionAnswer>

export interface DecisionRequest {
  state: DecisionModelState
  questions: DecisionQuestionMap
}

export interface DecisionUsage {
  stateTokens?: number
  truncated?: boolean
}

export interface DecisionResult {
  answers: DecisionAnswers
  usage?: DecisionUsage
}

export interface DecisionDecideOptions {
  /** Abort a request that outlives its budget. */
  signal?: AbortSignal
}

/**
 * A decision engine. Implement this over any local runtime (ONNX Runtime, a
 * vendored engine, a remote gateway) and register it in `nuxt.config`.
 * The module ships a default ONNX adapter, so users only implement this when
 * they want a different runtime.
 */
export interface DecisionModelAdapter {
  decide(request: DecisionRequest, options?: DecisionDecideOptions): Promise<DecisionResult>
  dispose?(): Promise<void> | void
}

export interface DecisionModelLoadOptions {
  /**
   * Where the model lives. Three forms: a local directory (or `.onnx` file),
   * a full `https://` URL (`.onnx` file or a shared-prefix manifest directory),
   * or a Hugging Face id such as `my-org/my-decision-model`
   * (optionally `id@revision`) resolved to `…/resolve/<revision>/`.
   * Shared-prefix models point at the manifest directory (or the HF id);
   * the adapter reads `manifest.json` + tokenizer + model from it.
   */
  source: string
  /**
   * Hugging Face revision (branch, tag or commit) used when `source` is a
   * Hugging Face id. Defaults to `main`.
   */
  revision?: string
  /**
   * Export subdirectory inside the repo for bare HF ids with the
   * shared-prefix adapter (default `onnx/`). Full URLs and local paths
   * already point at the directory, so they ignore it.
   */
  subdir?: string
  /**
   * Fetch implementation used to download remote models. Defaults to
   * `globalThis.fetch`; injectable for tests and for hosts proxying weights.
   */
  fetch?: typeof fetch
  /**
   * Adapter factory path, resolved at runtime — or `"shared-prefix"` for the
   * bundled manifest-directory adapter, which runs exports with one prompt
   * prefix per question. Defaults to the module's bundled ONNX adapter.
   */
  adapter?: string
  /**
   * Hugging Face id of the tokenizer matching this checkpoint, e.g.
   * `"Xenova/all-MiniLM-L6-v2"`. Defaults to that MiniLM tokenizer when unset.
   */
  tokenizer?: string
  /**
   * ONNX output name -> question id map. Only read by the bundled ONNX adapter:
   * real checkpoints name their outputs `logits`, `choice_0`, `head`, or
   * `output.1` rather than after the question id.
   */
  outputMap?: Record<string, string>
  /** Token budget passed to the tokenizer as its truncation limit. */
  maxTokens?: number
  /** Passed through to the adapter untouched. */
  sessionOptions?: Record<string, unknown>
}

export type DecisionModelDefinition = DecisionModelLoadOptions

export type DecisionModelRegistry = Record<string, DecisionModelDefinition>

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
  decisionModels?: DecisionModelRegistry
}

export type LocalModelConfig<TModels extends LocalModelModelRegistry = LocalModelModelRegistry> = LocalModelRuntimeConfig<TModels>

export type LocalModelRunner = LocalModelCallable & {
  dispose?: () => Promise<void> | void
}

export {}
