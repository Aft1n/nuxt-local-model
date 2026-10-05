import type {
  DecisionDecideOptions,
  DecisionModelAdapter,
  DecisionModelLoadOptions,
  DecisionRequest,
  DecisionResult,
} from "../types"
import { type InternalLocalModelRuntimeConfig, resolveDecisionModelDefinition } from "../utils"
import {
  decisionSessionKey,
  getDecisionSession,
  releaseDecisionSession,
  resetDecisionSessions,
} from "../shared/decision-session"

const runtimeConfigSymbol = Symbol.for("nuxt-local-model:runtime-config")

const DEFAULT_TOKENIZER = "Xenova/all-MiniLM-L6-v2"

export { resetDecisionSessions as resetDecisionModelCache }

export interface ServerDecisionModel {
  readonly definition: DecisionModelLoadOptions
  decide(request: DecisionRequest, options?: DecisionDecideOptions): Promise<DecisionResult>
  dispose(): Promise<void>
}

export type ServerDecisionAdapterFactory = (
  options: DecisionModelLoadOptions,
) => Promise<DecisionModelAdapter> | DecisionModelAdapter

/**
 * Server-side entry point for decision models.
 *
 * Nitro server routes do not receive Nuxt's app auto-imports, so
 * `useDecisionModel()` is unavailable there. This reads the same resolved
 * config the module stashes at build time and caches sessions per definition,
 * matching `getLocalModel()`.
 */
export async function getDecisionModel(
  name: string,
  overrides: {
    source?: string
    adapter?: ServerDecisionAdapterFactory
    /**
     * Explicit resolved config. Nitro server routes do not run the Nuxt app
     * plugins that populate the global store, so routes should pass
     * `useRuntimeConfig().public.localModel` here instead of relying on it.
     */
    config?: InternalLocalModelRuntimeConfig
  } = {},
): Promise<ServerDecisionModel> {
  const stored = overrides.config
    ?? ((globalThis as Record<PropertyKey, unknown>)[runtimeConfigSymbol] as InternalLocalModelRuntimeConfig | undefined)
  const definition = resolveDecisionModelDefinition(name, stored, {
    ...(overrides.source ? { source: overrides.source } : {}),
  })

  const key = decisionSessionKey(name, definition, overrides.adapter)

  const session = getDecisionSession(key, () => createAdapter(definition, overrides.adapter))
  const adapter = await session

  let disposed = false
  return {
    definition,
    decide: (request, decideOptions) => adapter.decide(request, decideOptions),
    dispose: async () => {
      if (disposed) return
      disposed = true
      // Last holder disposes; a superseded session stays alive for its holders.
      if (releaseDecisionSession(key, session)) {
        await adapter.dispose?.()
      }
    },
  }
}

async function createAdapter(
  definition: DecisionModelLoadOptions,
  override?: ServerDecisionAdapterFactory,
): Promise<DecisionModelAdapter> {
  const factory = override ?? (await resolveConfiguredAdapter(definition.adapter))
  return factory(definition)
}

async function resolveConfiguredAdapter(specifier?: string): Promise<ServerDecisionAdapterFactory> {
  // "shared-prefix" selects the bundled manifest-directory adapter (manifest +
  // tokenizer + model.onnx, local dir / URL / HF id). Dynamically imported to
  // keep the runtime peers out of the bundle until a model is loaded.
  if (specifier?.toLowerCase() === "shared-prefix") {
    const { createDecisionSharedPrefixAdapter } = await import("../shared/decision-shared-prefix")
    return options => createDecisionSharedPrefixAdapter(options)
  }
  if (!specifier) {
    const { createDecisionOnnxAdapter } = await import("../shared/decision-onnx")
    const { AutoTokenizer } = await import("@huggingface/transformers")
    return async (options) => {
      // Loaded once per adapter instance: a tokenizer is a multi-megabyte
      // vocabulary table. MiniLM is only the fallback, since a decision model
      // brings its own vocabulary.
      const tokenizer = await AutoTokenizer.from_pretrained(
        options.tokenizer ?? DEFAULT_TOKENIZER,
      )
      return createDecisionOnnxAdapter({
        ...options,
        encode: async (text: string) =>
          // Transformers.js takes the model's own context length by default,
          // which is exactly the silent truncation the adapter must report.
          tokenizer(text, {
            padding: true,
            truncation: true,
            ...(options.maxTokens === undefined ? {} : { max_length: options.maxTokens }),
          }) as unknown as {
            input_ids: unknown
            attention_mask?: unknown
            token_type_ids?: unknown
          },
      })
    }
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

function resolveFactory(loaded: unknown): ServerDecisionAdapterFactory | undefined {
  if (typeof loaded === "function") return loaded as ServerDecisionAdapterFactory
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    const fallback = (loaded as { default?: unknown }).default
    if (typeof fallback === "function") return fallback as ServerDecisionAdapterFactory
  }
  return undefined
}
