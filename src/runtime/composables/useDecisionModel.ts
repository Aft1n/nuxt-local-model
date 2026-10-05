import { useRuntimeConfig } from "nuxt/app"
import type {
  DecisionDecideOptions,
  DecisionModelAdapter,
  DecisionModelLoadOptions,
  DecisionRequest,
  DecisionResult,
} from "../types"
import { resolveDecisionModelDefinition } from "../utils"
import {
  decisionSessionKey,
  getDecisionSession,
  releaseDecisionSession,
  reloadDecisionSession,
  resetDecisionSessions,
} from "../shared/decision-session"

interface DecisionRuntimeConfig {
  decisionModels?: Record<string, DecisionModelLoadOptions>
}

export { resetDecisionSessions as resetDecisionModelCache }

export type DecisionModelAdapterFactory = (
  options: DecisionModelLoadOptions,
) => Promise<DecisionModelAdapter> | DecisionModelAdapter

export interface UseDecisionModelOptions {
  /** Override the configured adapter factory for this call. */
  adapter?: DecisionModelAdapterFactory
  /** Override the configured model source for this call. */
  source?: string
  /** Bypass the session cache and load a fresh adapter. */
  reload?: boolean
}

export interface DecisionModel<TOptions extends DecisionDecideOptions = DecisionDecideOptions> {
  /** The resolved definition this instance was created from. */
  readonly definition: DecisionModelLoadOptions
  /** Evaluate typed questions against a state. */
  decide(request: DecisionRequest, options?: TOptions): Promise<DecisionResult>
  /** Release the underlying session. */
  dispose(): Promise<void>
}

/**
 * Load a decision model registered under `localModel.decisionModels` in
 * `nuxt.config` and return a judge for it.
 *
 * Decision models answer bounded questions with probabilities rather than
 * generating text: `noul` returns a 0..1 truth value, `choice` picks one of the
 * supplied options with a distribution, and `score` places the state on an
 * ordered set of levels.
 *
 * ```ts
 * const triage = await useDecisionModel("triage")
 * const { answers } = await triage.decide({
 *   state: "charged twice, please refund",
 *   questions: {
 *     wants_refund: { type: "noul", instructions: "Does the user want a refund?" },
 *     department: {
 *       type: "choice",
 *       instructions: "Which team handles this?",
 *       criteria: { billing: "invoices", other: "everything else" },
 *     },
 *   },
 * })
 * ```
 */
export async function useDecisionModel(
  name: string,
  options: UseDecisionModelOptions = {},
): Promise<DecisionModel> {
  const runtimeConfig = useRuntimeConfig().public.localModel as DecisionRuntimeConfig | undefined
  const definition = resolveDecisionModelDefinition(name, runtimeConfig, {
    ...(options.source ? { source: options.source } : {}),
  })

  // An override factory is a different runtime than the configured one, so it
  // must not share a cached session with it. Identity is part of the key.
  const key = decisionSessionKey(name, definition, options.adapter)
  const load = () => createAdapter(definition, options.adapter)
  const session = options.reload
    ? reloadDecisionSession(key, load)
    : getDecisionSession(key, load)
  const adapter = await session

  let disposed = false
  return {
    definition,
    decide: (request, decideOptions) => adapter.decide(request, decideOptions),
    dispose: async () => {
      if (disposed) return
      disposed = true
      // Last holder disposes; a reload that superseded this session leaves
      // other holders using it until their own release.
      if (releaseDecisionSession(key, session)) {
        await adapter.dispose?.()
      }
    },
  }
}

async function createAdapter(
  definition: DecisionModelLoadOptions,
  override?: DecisionModelAdapterFactory,
): Promise<DecisionModelAdapter> {
  const factory = override ?? (await resolveConfiguredAdapter(definition.adapter))
  return factory(definition)
}

async function resolveConfiguredAdapter(specifier?: string): Promise<DecisionModelAdapterFactory> {
  // "shared-prefix" selects the bundled manifest-directory adapter (manifest +
  // tokenizer + model.onnx, local dir / URL / HF id). Dynamically imported to
  // keep the runtime peers out of the browser bundle until a model is loaded.
  if (specifier?.toLowerCase() === "shared-prefix") {
    const { createDecisionSharedPrefixAdapter } = await import("../shared/decision-shared-prefix")
    return options => createDecisionSharedPrefixAdapter(options)
  }
  if (!specifier) {
    const { createDecisionOnnxAdapter } = await import("../shared/decision-onnx")
    return async options =>
      createDecisionOnnxAdapter({
        ...options,
        // The bundled adapter encodes text with Transformers.js so callers do
        // not have to hand-roll tokenization for their ONNX graph. MiniLM is
        // only the fallback: a decision model brings its own vocabulary.
        encode: await createTextEncoder(options.tokenizer, options.maxTokens),
      })
  }

  const loaded = await import(/* @vite-ignore */ specifier)
  const factory = resolveFactory(loaded)
  if (!factory) {
    throw new Error(
      `Decision model adapter "${specifier}" must export a factory function returning a DecisionModelAdapter.`,
    )
  }
  return factory
}

function resolveFactory(loaded: unknown): DecisionModelAdapterFactory | undefined {
  if (typeof loaded === "function") return loaded as DecisionModelAdapterFactory
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    const fallback = (loaded as { default?: unknown }).default
    if (typeof fallback === "function") return fallback as DecisionModelAdapterFactory
  }
  return undefined
}

const DEFAULT_TOKENIZER = "Xenova/all-MiniLM-L6-v2"

async function createTextEncoder(tokenizer?: string, maxTokens?: number) {
  const { AutoTokenizer } = await import("@huggingface/transformers")
  // Loaded once per adapter instance: a tokenizer is a multi-megabyte vocab.
  const instance = await AutoTokenizer.from_pretrained(tokenizer ?? DEFAULT_TOKENIZER)
  return async (text: string) => {
    const encoded = await instance(text, {
      padding: true,
      truncation: true,
      // Transformers.js takes the model's own context length by default, which
      // is exactly the silent truncation the adapter must be able to report.
      ...(maxTokens === undefined ? {} : { max_length: maxTokens }),
    })
    return encoded as unknown as {
      input_ids: unknown
      attention_mask?: unknown
      token_type_ids?: unknown
    }
  }
}


