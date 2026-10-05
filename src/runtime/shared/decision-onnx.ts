import type {
  DecisionAnswer,
  DecisionAnswers,
  DecisionDecideOptions,
  DecisionModelAdapter,
  DecisionModelLoadOptions,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
  DecisionUsage,
} from "../types"
import { assertDecisionQuestions, assertDecisionState } from "./decision-validate"
import { isHttpUrl } from "./decision-source"
/**
 * Minimal structural view of ONNX Runtime. Both `onnxruntime-node` and
 * `onnxruntime-web` satisfy it, and both are optional peer dependencies of the
 * host app, so this module imports neither directly.
 */
interface OrtTensor {
  data: ArrayLike<number> | number[]
  /** Output rank. Both `onnxruntime-node` and `onnxruntime-web` expose `dims`. */
  dims?: readonly number[]
  /** Some runtimes name it `shape` instead; treated as an alias. */
  shape?: readonly number[]
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>
}

interface OrtLike {
  InferenceSession: {
    create(path: string | Uint8Array | ArrayBufferLike, options?: Record<string, unknown>): Promise<OrtSession>
  }
  Tensor: new (type: string, data: ArrayLike<number> | number[], dims?: number[]) => unknown
}

/** Everything a tokenizer hands back; `input_ids` is the only required field. */
export interface DecisionEncodedInput {
  input_ids: unknown
  attention_mask?: unknown
  token_type_ids?: unknown
}

export interface DecisionOnnxAdapterOptions extends DecisionModelLoadOptions {
  /**
   * Tokenizer used to encode the state and question text. Decision models are
   * text encoders, so raw bytes cannot be fed to the session directly; supply a
   * `@huggingface/transformers` tokenizer here.
   */
  encode: (text: string) => Promise<DecisionEncodedInput>
  /**
   * Maps a session output name to the question id it answers. Replaces the
   * default resolution chain entirely, for graphs whose conventions are too
   * unusual to describe declaratively.
   */
  resolveOutput?: (outputName: string) => string | undefined
}

function toArray(data: ArrayLike<number> | number[]) {
  return Array.isArray(data) ? data : Array.from(data)
}

/**
 * Flatten a decision-head tensor down to one logit per class/option.
 *
 * Exported ONNX decision heads emit `[batch, classes]` (sometimes with extra
 * singleton axes) while a decision request always asks a single question, so
 * the final axis is the class/option dimension and every row before the last is
 * batch noise. Taking the trailing `dims.at(-1)` values yields the last row,
 * which is the decision for this request. A tensor that reports no shape — or a
 * one-dimensional one — is already flat and passes through unchanged.
 */
function lastAxisValues(tensor: OrtTensor): number[] {
  const flat = toArray(tensor.data)
  const dims = tensor.dims ?? tensor.shape
  if (!dims || dims.length <= 1) return flat

  const width = dims[dims.length - 1] ?? 0
  if (width <= 0 || flat.length < width) return flat
  return flat.slice(flat.length - width)
}

/**
 * Fit a model head to the answer space the question declared.
 *
 * Real checkpoints have a fixed-width head (say 5 logits) regardless of how
 * many options a request declares. Longer vectors are sliced: trailing logits
 * belong to options the question never offered. Shorter vectors are padded with
 * zero logits: a zero logit is a neutral member of the softmax (exp(0)=1), so
 * the available logits still shape the distribution, probabilities still sum
 * to 1, and every declared option gets an entry rather than being missing.
 */
function projectLogits(logits: number[], declared: number): number[] {
  if (declared <= 0) return []
  if (logits.length >= declared) return logits.slice(0, declared)
  return [...logits, ...new Array<number>(declared - logits.length).fill(0)]
}

/** How many declared options/levels a question asks the model to choose from. */
function declaredCount(question: DecisionQuestion): number {
  if (question.type === "choice") return Object.keys(question.criteria).length
  if (question.type === "score") return question.criteria.length
  // noul is a single yes/no logit, regardless of its optional outcome labels.
  return 1
}

/** Argmax over the final axis of a flat logit vector. */
function argmax(values: number[]) {
  let best = 0
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) best = i
  }
  return best
}

/**
 * Map non-finite logits (NaN/±Inf from a bad head) to 0 — the neutral member of
 * a softmax — so probabilities, confidence and score stay finite.
 */
function sanitizeLogits(values: number[]): number[] {
  return values.map(value => (Number.isFinite(value) ? value : 0))
}

function softmax(values: number[]) {
  if (values.length === 0) return values
  const max = Math.max(...values)
  const exps = values.map(value => Math.exp(value - max))
  const total = exps.reduce((sum, value) => sum + value, 0)
  return exps.map(value => (total === 0 ? 1 / values.length : value / total))
}

/**
 * Distribution concentration, `1 - H(p) / ln(N)`, where `H(p) = -Σ pᵢ ln pᵢ`.
 * Zero means uniform probabilities, values near 1 mean one candidate dominates.
 * It measures how concentrated a distribution is, not calibrated correctness.
 *
 * Edge cases: fewer than two candidates is trivially certain (1); a zero
 * probability contributes `0 * ln 0 = 0` so the term is skipped rather than
 * producing NaN; the result is clamped to `[0, 1]`.
 */
export function entropyConfidence(probabilities: number[]): number {
  const n = probabilities.length
  if (n < 2) return 1

  let entropy = 0
  for (const p of probabilities) {
    if (p > 0) entropy -= p * Math.log(p)
  }

  const maxEntropy = Math.log(n)
  if (maxEntropy === 0) return 1
  return Math.min(1, Math.max(0, 1 - entropy / maxEntropy))
}

function answerFromLogits(
  question: DecisionQuestion,
  logits: number[],
): DecisionAnswer {
  const fitted = sanitizeLogits(projectLogits(logits, declaredCount(question)))

  if (question.type === "choice") {
    const options = Object.keys(question.criteria)
    const normalized = softmax(options.map((_, index) => fitted[index] ?? 0))
    const winner = argmax(normalized)

    return {
      type: "choice",
      choice: options[winner] ?? "",
      probabilities: Object.fromEntries(options.map((option, index) => [option, normalized[index] ?? 0])),
      confidence: entropyConfidence(normalized),
    }
  }

  if (question.type === "score") {
    const levels = question.criteria
    const normalized = softmax(levels.map((_, index) => fitted[index] ?? 0))
    const legend = Object.fromEntries(levels.map((level, index) => [String(index), level]))

    return {
      type: "score",
      score: normalized.reduce((sum, probability, index) => sum + probability * index, 0),
      probabilities: Object.fromEntries(levels.map((_, index) => [String(index), normalized[index] ?? 0])),
      confidence: entropyConfidence(normalized),
      legend,
    }
  }

  // noul: a single logit turned into a probability.
  const probability = 1 / (1 + Math.exp(-(fitted[0] ?? 0)))
  return { type: "noul", noul: probability }
}

/**
 * Resolve a session output name to a question id.
 *
 * Chain, in order:
 *   1. exact question id match — the graph names its outputs after the
 *      questions, the convention this adapter was written against;
 *   2. `outputMap` — the declarative escape hatch for graphs naming outputs
 *      `logits`, `choice_0`, `head`, `output.1`;
 *   3. (applied by the caller) single-output / single-question fallback — a
 *      head emitting one vector can only answer a request asking one question;
 *   4. otherwise unmatched.
 */
function resolveOutputId(
  outputName: string,
  questionIds: string[],
  outputMap: Record<string, string> | undefined,
): string | undefined {
  if (questionIds.includes(outputName)) return outputName
  const mapped = outputMap?.[outputName]
  if (mapped && questionIds.includes(mapped)) return mapped
  return undefined
}

/** Token count of the encoded state, when the tokenizer exposes a shape. */
function tokenCount(encoded: DecisionEncodedInput): number | undefined {
  const ids = encoded.input_ids
  if (!ids || typeof ids !== "object") return undefined
  const dims = "dims" in ids ? ids.dims : "shape" in ids ? ids.shape : undefined
  if (!Array.isArray(dims) || dims.length === 0) return undefined
  const last = dims[dims.length - 1]
  return typeof last === "number" ? last : undefined
}

/**
 * Download a remote `.onnx` model, or return `undefined` when `source` is a
 * local path/directory that ONNX Runtime opens itself. Directory URLs (e.g.
 * a shared-prefix manifest directory) belong to their own adapter, not here.
 */
async function loadModelBytes(
  options: DecisionOnnxAdapterOptions,
): Promise<Uint8Array | undefined> {
  const { source } = options
  if (!isHttpUrl(source) || !/\.onnx(\?.*)?$/i.test(source)) {
    return undefined
  }
  const response = await (options.fetch ?? globalThis.fetch)(source)
  if (!response.ok) {
    throw new Error(`Failed to download decision model from ${source}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Default adapter: runs a single-graph encoder + decision head
 * (`input_ids` in, one flat logit tensor per question out).
 *
 * Kept deliberately small: it validates the typed request, delegates the
 * forward pass to ONNX Runtime, and projects logits back onto the declared
 * answer space. Users needing different graph conventions implement
 * `DecisionModelAdapter` and point `adapter` at their factory.
 */
export async function createDecisionOnnxAdapter(
  options: DecisionOnnxAdapterOptions,
): Promise<DecisionModelAdapter> {
  const ort = (await loadOnnxRuntime()) as OrtLike
  // CPU is the safe default: CPU-only VPS hosts are a first-class deployment
  // target with no GPU backend to fall back to. `sessionOptions` is spread last
  // so browser users can still opt into `executionProviders: ["webgpu"]`, or
  // any other provider ONNX Runtime supports.
  const sessionOptions = {
    executionProviders: ["cpu"],
    ...options.sessionOptions,
  }
  // `onnxruntime-node` cannot open a remote URL and `onnxruntime-web` only does
  // so when told to, so `.onnx` URLs are downloaded here. That also makes
  // `fetch` injectable for tests and proxying. Local paths go straight to ORT,
  // which resolves them itself.
  const modelBytes = await loadModelBytes(options)
  const session = modelBytes
    ? await ort.InferenceSession.create(modelBytes, sessionOptions)
    : await ort.InferenceSession.create(options.source, sessionOptions)
  let disposed = false

  /** `session.run` cannot be interrupted, so aborts are checked at both ends. */
  function throwIfAborted(signal: AbortSignal | undefined) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError")
    }
  }

  return {
    async decide(request: DecisionRequest, decideOptions?: DecisionDecideOptions): Promise<DecisionResult> {
      throwIfAborted(decideOptions?.signal)
      assertDecisionState(request.state)
      assertDecisionQuestions(request.questions)

      const state = typeof request.state === "string"
        ? request.state
        : JSON.stringify(request.state)

      const encoded = await options.encode(state)
      const outputs = await session.run({
        input_ids: encoded.input_ids,
        ...(encoded.attention_mask ? { attention_mask: encoded.attention_mask } : {}),
        ...(encoded.token_type_ids ? { token_type_ids: encoded.token_type_ids } : {}),
      })
      throwIfAborted(decideOptions?.signal)

      const questionIds = Object.keys(request.questions)
      const outputNames = Object.keys(outputs)
      const singlePair = outputNames.length === 1 && questionIds.length === 1
      const resolve = options.resolveOutput
        ?? ((outputName: string) => resolveOutputId(outputName, questionIds, options.outputMap))
      const answers: DecisionAnswers = {}

      for (const [outputName, tensor] of Object.entries(outputs)) {
        const mapped = resolve(outputName)
        // Step 3 of the chain only kicks in for a lone output/question pair, so
        // a stray extra output keeps being ignored instead of stealing it.
        const questionId = mapped && request.questions[mapped]
          ? mapped
          : singlePair
            ? questionIds[0]
            : undefined
        if (!questionId) continue
        const question = request.questions[questionId]
        if (!question) continue
        answers[questionId] = answerFromLogits(question, lastAxisValues(tensor))
      }

      // Returning `{}` here reads as "the model had nothing to say", which is
      // indistinguishable from a wiring mistake. Naming both sides makes the
      // misconfiguration obvious.
      if (questionIds.length > 0 && Object.keys(answers).length === 0) {
        const available = outputNames.length > 0
          ? outputNames.map(name => `"${name}"`).join(", ")
          : "(none)"
        throw new Error(
          `Decision model "${options.source}" produced no answer for any question. `
          + `Session output names: ${available}. `
          + `Requested question ids: ${questionIds.map(id => `"${id}"`).join(", ")}. `
          + `Map them with "outputMap" in the decision model definition.`,
        )
      }

      const stateTokens = tokenCount(encoded)
      // `truncated` is reported only when the encoded length hit a budget we
      // configured. Leaving it undefined beats claiming `false`, which would
      // assert nothing was trimmed while the tokenizer may have applied its
      // own, invisible, limit.
      const truncated = stateTokens !== undefined
        && options.maxTokens !== undefined
        && stateTokens >= options.maxTokens
      const usage: DecisionUsage = {
        ...(stateTokens === undefined ? {} : { stateTokens }),
        ...(truncated ? { truncated: true } : {}),
      }

      return Object.keys(usage).length > 0 ? { answers, usage } : { answers }
    },
    // ORT only frees the session when told to; runtimes that expose no release
    // method simply keep it alive until GC, so this is a no-op there. Releasing
    // twice throws in ORT, hence the latch.
    async dispose() {
      if (disposed) return
      disposed = true
      const releasable = session as OrtSession & {
        release?: () => Promise<void> | void
        close?: () => Promise<void> | void
        dispose?: () => Promise<void> | void
      }
      await (releasable.release ?? releasable.close ?? releasable.dispose)?.call(session)
    },
  }
}

/** `onnxruntime-web` in the browser, `onnxruntime-node` elsewhere. */
async function loadOnnxRuntime(): Promise<OrtLike> {
  const runtime = globalThis as { document?: unknown; window?: unknown }
  const isBrowser = typeof runtime.document !== "undefined" && typeof runtime.window !== "undefined"
  const specifier = isBrowser ? "onnxruntime-web" : "onnxruntime-node"

  try {
    // Dynamic import is deliberate: the specifier is chosen from the environment
    // (browser -> onnxruntime-web, otherwise -> onnxruntime-node) and both are
    // optional peer dependencies of the host app. A static import would resolve
    // at build time and force one runtime into the browser bundle.
    return (await import(/* @vite-ignore */ specifier)) as OrtLike
  } catch (cause) {
    throw new Error(
      `Decision models need ONNX Runtime. Install the optional peer dependency \`${specifier}\` to run them locally.`,
      { cause },
    )
  }
}
