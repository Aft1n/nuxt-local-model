/**
 * Shared-prefix decision adapter.
 *
 * Runs a manifest-directory export — `manifest.json` + `tokenizer.json` +
 * `model.onnx` — as a decision model. That wire format shares one prompt prefix
 * across a set of short candidate documents and scores them with one forward
 * pass returning `logits` of shape `[documents, tasks]`.
 *
 * Every dependency below is loaded at runtime, so `onnxruntime-node`/
 * `onnxruntime-web` and `@huggingface/tokenizers` stay optional peers and this
 * module stays out of the browser bundle until a model is actually loaded.
 */

import type {
  DecisionAnswer,
  DecisionAnswers,
  DecisionDecideOptions,
  DecisionModelAdapter,
  DecisionModelLoadOptions,
  DecisionNoulQuestion,
  DecisionQuestion,
  DecisionRequest,
  DecisionResult,
  DecisionUsage,
} from "../types"
import { entropyConfidence } from "./decision-onnx"
import { isHfId, isHttpUrl, resolveDecisionSource } from "./decision-source"
import { assertDecisionState, assertDecisionQuestions } from "./decision-validate"

/**
 * Graph surface of a shared-prefix export, kept structural so neither ONNX
 * Runtime package is imported for its types.
 */
interface OrtTensor {
  data: ArrayLike<number> | number[]
  /** `onnxruntime-node` exposes `dims`; some builds spell it `shape`. */
  dims?: readonly number[]
  shape?: readonly number[]
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>
}

interface OrtLike {
  InferenceSession: {
    create(buffer: ArrayBufferLike | Uint8Array, options?: Record<string, unknown>): Promise<OrtSession>
  }
  // ORT accepts bigint-backed typed arrays for `int64` feeds, so the element
  // type here is `never`-compatible with them rather than `number`.
  Tensor: new (type: string, data: ArrayLike<number | bigint> | number[], dims?: number[]) => unknown
}

/** The subset of the manifest-directory `manifest.json` this adapter reads. */
export interface SharedPrefixManifest {
  /** Logit column name per index; the request's question id selects one. */
  tasks: string[]
  model_file?: string
  model_bytes?: number
  /** Prefix length, excluding the `[cls]`/`[sep]` pair. */
  query_length?: number
  /** Per-candidate document budget. */
  document_length?: number
  cls_token_id?: number
  sep_token_id?: number
  pad_token_id?: number
}

/** The `Tokenizer` shape of `@huggingface/tokenizers` that this adapter uses. */
interface TokenizerLike {
  encode(text: string, options?: { add_special_tokens?: boolean }): { ids: number[] }
}

/** The manifest token-id fields, under the names the browser export uses. */
interface SharedPrefixManifestWithTokenIds extends SharedPrefixManifest {
  cls_id?: number
  sep_id?: number
  pad_id?: number
}

export interface DecisionSharedPrefixAdapterOptions extends DecisionModelLoadOptions {
  /** Injectable fetch, so hosts can add auth, proxy or caching. */
  fetch?: typeof globalThis.fetch
  /**
   * Token ids for a piece of text. Defaults to the model directory's own
   * `tokenizer.json`, loaded through `@huggingface/tokenizers`.
   */
  encode?: (text: string) => Promise<number[]>
}

/** Defaults matching the reference browser export. */
const DEFAULT_QUERY_LENGTH = 512
const DEFAULT_DOCUMENT_LENGTH = 128
/**
 * Upper bound on the int64 cells one forward pass carries. Purely a heap
 * heuristic — ORT copies every feed per run, and the practical limit is what
 * the host survives, not anything the format specifies.
 */
const MAX_BATCH_CELLS = 1048576

// ---------------------------------------------------------------------------
// Reading the model directory
// ---------------------------------------------------------------------------

/** Where `source` points once the Hugging Face id form is expanded. */
interface ModelLocation {
  /** Base URL ending in `/`, or `null` when the files are on disk. */
  baseUrl: string | null
  /** Local directory, or `null` when the files are fetched. */
  dir: string | null
  /** Model file name, when `source` named the file rather than its directory. */
  modelFile?: string
}

/**
 * Resolve `source` to the directory holding `manifest.json`, the model file and
 * the tokenizer files. A source naming the `.onnx` file itself is accepted too
 * — the manifest and tokenizer are read from the directory beside it, and the
 * named file wins over the manifest's `model_file`.
 */
function resolveLocation(source: string, revision?: string, subdir = "onnx"): ModelLocation {
  // A bare Hub id names the repo, but the runtime files live in its manifest
  // export subdirectory (default `onnx/`, overridable per model).
  const base = isHfId(source)
    ? `${resolveDecisionSource(source, { revision }).replace(/\/+$/, "")}/${subdir.replace(/^\/+|\/+$/g, "")}/`
    : resolveDecisionSource(source, { revision })
  if (isHttpUrl(base)) {
    const name = base.split("/").pop()!
    const modelFile = /\.onnx([?#].*)?$/i.test(name) ? name.replace(/[?#].*$/, "") : undefined
    return {
      baseUrl: `${base.replace(/\/[^/]*$/, "").replace(/\/+$/, "")}/`,
      dir: null,
      ...(modelFile ? { modelFile } : {}),
    }
  }
  const isModelFile = /\.onnx([?#].*)?$/i.test(base)
  return {
    baseUrl: null,
    dir: isModelFile ? base.slice(0, Math.max(0, base.lastIndexOf("/"))) : base.replace(/[/\\]+$/, ""),
    ...(isModelFile ? { modelFile: base.slice(base.lastIndexOf("/") + 1) } : {}),
  }
}

/** The model file to read: the one `source` named, else the manifest's own. */
function modelFileName(location: ModelLocation, manifest: SharedPrefixManifest) {
  return location.modelFile ?? manifest.model_file ?? "model.onnx"
}

function requireFetch(injected: typeof globalThis.fetch | undefined, url: string) {
  const impl = injected ?? globalThis.fetch
  if (typeof impl !== "function") {
    throw new Error(
      `Shared-prefix decision model: no \`fetch\` available to download ${url}. `
      + "Pass one via the `fetch` option when running outside a platform that provides it.",
    )
  }
  return impl
}

async function readText(location: ModelLocation, name: string, fetchImpl?: typeof globalThis.fetch) {
  if (location.dir) {
    // `node:fs` is a dynamic import so bundlers keep it out of browser builds,
    // where this branch is unreachable anyway.
    const { readFile } = await import(/* @vite-ignore */ "node:fs/promises")
    return readFile(`${location.dir}/${name}`, "utf8")
  }
  const url = `${location.baseUrl}${name}`
  const response = await requireFetch(fetchImpl, url)(url)
  if (!response.ok) {
    throw new Error(`Shared-prefix decision model: could not fetch ${url} (HTTP ${response.status}).`)
  }
  return response.text()
}

async function readBytes(location: ModelLocation, name: string, fetchImpl?: typeof globalThis.fetch) {
  if (location.dir) {
    const { readFile } = await import(/* @vite-ignore */ "node:fs/promises")
    const buffer = await readFile(`${location.dir}/${name}`)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  }
  const url = `${location.baseUrl}${name}`
  const response = await requireFetch(fetchImpl, url)(url)
  if (!response.ok) {
    throw new Error(`Shared-prefix decision model: could not fetch ${url} (HTTP ${response.status}).`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Load the model directory's own tokenizer. `@huggingface/tokenizers` is an
 * optional peer, imported dynamically so it is neither bundled nor a hard
 * dependency; `encode` in the options replaces it entirely.
 */
async function createDirectoryEncoder(
  location: ModelLocation,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<(text: string) => Promise<number[]>> {
  const json = await readText(location, "tokenizer.json", fetchImpl).catch((cause: Error) => {
    throw new Error(
      `Shared-prefix decision model: could not read tokenizer.json next to the manifest (${cause.message}). `
      + "Pass an `encode` function when the tokenizer lives elsewhere.",
      { cause },
    )
  })

  let Tokenizer: (new (json: object, config?: object) => TokenizerLike) | undefined
  try {
    // Optional peer dependency: only the host app decides to ship it.
    // @ts-ignore — resolves at runtime; may be absent from the consumer's install.
    ({ Tokenizer } = await import(/* @vite-ignore */ "@huggingface/tokenizers") as {
      Tokenizer?: new (json: object, config?: object) => TokenizerLike
    })
  } catch (cause) {
    throw new Error(
      "Shared-prefix decision models need the optional peer dependency `@huggingface/tokenizers`. "
      + "Install it, or pass an `encode` function returning token ids.",
      { cause },
    )
  }
  if (!Tokenizer) {
    throw new Error(
      "`@huggingface/tokenizers` loaded without exporting `Tokenizer`. Pass an `encode` function instead.",
    )
  }

  // tokenizer.json is the serialized vocabulary; the second ctor arg is the
  // JS-side config (tokenizer_config.json). Both ship in the directory.
  const config = await readText(location, "tokenizer_config.json", fetchImpl).catch(() => "{}")
  const tokenizer = new Tokenizer(JSON.parse(json), JSON.parse(config))
  // No special tokens: `[cls]`/`[sep]` and the markers render explicitly.
  return async (text: string) => tokenizer.encode(text, { add_special_tokens: false }).ids
}

// ---------------------------------------------------------------------------
// Prompt layout
// ---------------------------------------------------------------------------

interface Prefix {
  ids: number[]
  /** Tokens the `query_length` budget had to drop. */
  dropped: number
}

/**
 * Render the shared prefix candidates are scored against:
 * `[cls] [Instruction: …] \n [State: …] [sep]`.
 *
 * Layout, marker text and budget split mirror the reference browser/Python
 * renderer: markers and the newline separator are fixed overhead, the
 * instruction takes a ceiling share of what remains, the state the floor
 * share, and either side absorbs what the other leaves unused.
 */
async function renderPrefix(options: {
  manifest: SharedPrefixManifestWithTokenIds
  encode: (text: string) => Promise<number[]>
  instruction: string
  state: string
  budget: number
}): Promise<Prefix> {
  const { manifest, encode, budget } = options
  const cls = manifest.cls_token_id ?? manifest.cls_id ?? 0
  const sep = manifest.sep_token_id ?? manifest.sep_id ?? 0
  const [instructionMarker, stateMarker, newline, instructionIds, stateIds] = await Promise.all([
    encode("Instruction: "),
    encode("State: "),
    encode("\n"),
    encode(options.instruction),
    encode(options.state),
  ])

  const bodyBudget = Math.max(
    0,
    budget - 2 - instructionMarker.length - stateMarker.length - newline.length,
  )
  let keptInstruction = Math.min(instructionIds.length, Math.ceil(bodyBudget / 2))
  let keptState = Math.min(stateIds.length, Math.floor(bodyBudget / 2))
  keptInstruction += Math.min(
    instructionIds.length - keptInstruction,
    bodyBudget - keptInstruction - keptState,
  )
  keptState += Math.min(stateIds.length - keptState, bodyBudget - keptInstruction - keptState)
  const dropped = instructionIds.length + stateIds.length - keptInstruction - keptState

  return {
    ids: [
      cls,
      ...instructionMarker,
      ...instructionIds.slice(0, keptInstruction),
      ...newline,
      ...stateMarker,
      ...stateIds.slice(0, keptState),
      sep,
    ],
    dropped,
  }
}

/** `Candidate: <id>: <description>` — the document form scored. */
function candidateDocument(id: string, description: string) {
  return `Candidate: ${id}: ${description}`
}

// ---------------------------------------------------------------------------
// Answer mapping
// ---------------------------------------------------------------------------

function softmax(values: number[]) {
  if (values.length === 0) return values
  // A non-finite logit (NaN/±Inf from a bad export) becomes 0, the neutral
  // member of a softmax, so probabilities and scores stay finite.
  const finite = values.map(value => (Number.isFinite(value) ? value : 0))
  const max = Math.max(...finite)
  const exps = finite.map(value => Math.exp(value - max))
  const total = exps.reduce((sum, value) => sum + value, 0)
  return exps.map(value => (total === 0 ? 1 / finite.length : value / total))
}

/** Reference-renderer default phrasings when a noul question authors no criteria. */
const DEFAULT_NOUL_YES = "Yes, the condition in the question holds."
const DEFAULT_NOUL_NO = "No, the condition in the question does not hold."

/**
 * The affirmative/negative meanings of a `noul` question. The reference
 * renderer embeds these in the state and scores them as the two candidates.
 */
function noulMeanings(question: DecisionNoulQuestion): { yes: string, no: string } {
  const criteria = question.criteria ?? {}
  return {
    yes: criteria.true ?? criteria.yes ?? DEFAULT_NOUL_YES,
    no: criteria.false ?? criteria.no ?? DEFAULT_NOUL_NO,
  }
}

/** Probability, confidence, legend and expected value for one question. */
function buildAnswer(
  questionId: string,
  question: DecisionQuestion,
  candidates: { id: string, document: string }[],
  logits: number[],
): DecisionAnswer {
  if (logits.length !== candidates.length) {
    throw new Error(
      `Decision question "${questionId}" declared ${candidates.length} candidates but the model returned ${logits.length} rows.`,
    )
  }
  const probabilities = softmax(logits)
  const byId = Object.fromEntries(candidates.map((c, index) => [c.id, probabilities[index] ?? 0]))
  const confidence = entropyConfidence(probabilities)

  if (question.type === "choice") {
    const options = Object.keys(question.criteria)
    if (options.length !== candidates.length) {
      throw new Error(
        `Decision question "${questionId}" declares ${options.length} options but the model scored ${candidates.length} candidates.`,
      )
    }
    let winner = 0
    for (let index = 1; index < probabilities.length; index += 1) {
      if (probabilities[index]! > probabilities[winner]!) winner = index
    }
    return {
      type: "choice",
      choice: options[winner] ?? "",
      probabilities: byId,
      confidence,
    }
  }

  if (question.type === "score") {
    const levels = question.criteria
    if (levels.length !== candidates.length) {
      throw new Error(
        `Decision question "${questionId}" declares ${levels.length} levels but the model scored ${candidates.length} candidates.`,
      )
    }
    const seen = new Set<string>()
    levels.forEach((level) => {
      if (!Number.isFinite(Number(level))) {
        throw new Error(
          `Decision question "${questionId}" level "${level}" is not a finite number, so no expected value exists.`,
        )
      }
      if (seen.has(level)) {
        throw new Error(
          `Decision question "${questionId}" repeats level "${level}"; distinct levels are required.`,
        )
      }
      seen.add(level)
    })
    const score = levels.reduce((sum, level, index) => sum + (probabilities[index] ?? 0) * Number(level), 0)
    return {
      type: "score",
      score,
      probabilities: byId,
      confidence,
      legend: Object.fromEntries(levels.map((level, index) => [String(index), level])),
    }
  }

  const probability = probabilities[0] ?? 0
  return { type: "noul", noul: probability, probabilities: byId, confidence }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Runs a shared-prefix decision model: one shared prompt prefix per question, one short
 * document per candidate, all candidates in a single batched forward pass.
 *
 * Each question gets its own forward pass because the format shares one prefix, while
 * a decision request pairs every question with its own instructions.
 */
export async function createDecisionSharedPrefixAdapter(
  options: DecisionSharedPrefixAdapterOptions,
): Promise<DecisionModelAdapter> {
  const location = resolveLocation(options.source, options.revision, options.subdir)
  const manifest = await loadManifest(location, options)
  const encode = options.encode ?? await createDirectoryEncoder(location, options.fetch)

  const ort = await loadOnnxRuntime()
  const weights = await readBytes(location, modelFileName(location, manifest), options.fetch)
  const session = await ort.InferenceSession.create(weights, {
    // CPU is the safe default: CPU-only hosts are a first-class deployment
    // target with no GPU backend to fall back to. `sessionOptions` spreads last
    // so browser users can still opt into `executionProviders: ["webgpu"]`.
    executionProviders: ["cpu"],
    ...options.sessionOptions,
  })

  const queryLength = options.maxTokens ?? manifest.query_length ?? DEFAULT_QUERY_LENGTH
  const documentLength = manifest.document_length ?? DEFAULT_DOCUMENT_LENGTH
  const pad = manifest.pad_token_id ?? manifest.pad_id ?? 0
  let disposed = false

  /** ORT cannot interrupt a run, so aborts are checked at both ends of it. */
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

      const rawState = request.state
      const answers: DecisionAnswers = {}
      let dropped = 0
      // Reported as the longest rendered prefix, the closest thing to a token
      // count for the state the model actually saw.
      let stateTokens = 0

      for (const [questionId, question] of Object.entries(request.questions)) {
        throwIfAborted(decideOptions?.signal)
        const taskColumn = manifest.tasks.indexOf(question.type)
        if (taskColumn < 0) {
          throw new Error(
            `Decision model "${options.source}" does not support "${question.type}" questions. `
            + "Manifest tasks: " + manifest.tasks.join(", "),
          )
        }

        // The reference renderer encodes state per question: a noul question
        // embeds its yes/no meanings next to the original state, and state
        // always travels as a JSON document.
        const state =
          question.type === "noul"
            ? JSON.stringify({ noul: noulMeanings(question), state: rawState })
            : JSON.stringify(rawState)

        const prefix = await renderPrefix({
          manifest,
          encode,
          instruction: question.instructions,
          state,
          budget: queryLength,
        })
        dropped += prefix.dropped
        stateTokens = Math.max(stateTokens, prefix.ids.length)

        const candidates = buildCandidates(question)
        // Candidate documents end with the sep token and fit the manifest's
        // document budget including it.
        const documents = await Promise.all(
          candidates.map(async candidate => [
            ...(await encode(candidate.document)).slice(0, documentLength - 1),
            manifest.sep_token_id ?? 0,
          ]),
        )
        const logits = await scoreDocuments(ort, session, prefix.ids, documents, pad)

        // Every candidate of a question is read from that question's task
        // column — the reference renderer reads one column per task.
        answers[questionId] = buildAnswer(
          questionId,
          question,
          candidates,
          logits.map(row => row[taskColumn] ?? 0),
        )
      }

      throwIfAborted(decideOptions?.signal)

      const usage: DecisionUsage = {
        stateTokens,
        ...(dropped > 0 ? { truncated: true } : {}),
      }
      return { answers, usage }
    },

    // ORT only frees the session when told to; releasing twice throws, hence
    // the latch. Runtimes exposing no release method keep it alive until GC.
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

/** Reject a manifest without the task table, which decides every logit column. */
async function loadManifest(location: ModelLocation, options: DecisionSharedPrefixAdapterOptions) {
  const raw = await readText(location, "manifest.json", options.fetch).catch((cause: Error) => {
    const where = location.baseUrl ?? location.dir ?? options.source
    throw new Error(
      `Shared-prefix decision model: no manifest.json under "${where}" (${cause.message}). `
      + "Point `source` at a manifest directory, or a Hugging Face id such as "
      + "`my-org/my-decision-model`.",
      { cause },
    )
  })
  const parsed = JSON.parse(raw) as SharedPrefixManifestWithTokenIds
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error(
      "Shared-prefix decision model: manifest.json declares no `tasks`, so no logit column can be resolved.",
    )
  }
  return parsed
}

/**
 * One candidate document per answer space member, all scored on the
 * question's task column — the layout the reference renderer uses.
 */
function buildCandidates(question: DecisionQuestion) {
  if (question.type === "choice") {
    return Object.entries(question.criteria).map(([id, description]) => ({
      id,
      document: candidateDocument(id, description),
    }))
  }
  if (question.type === "score") {
    return question.criteria.map((level, index) => ({
      id: String(index),
      document: candidateDocument(String(index), level),
    }))
  }
  // Canonical true/false ids: the reference renderer normalizes yes/no
  // criteria to them, and the id appears in the scored document text.
  const meanings = noulMeanings(question)
  return [
    { id: "true", document: candidateDocument("true", meanings.yes) },
    { id: "false", document: candidateDocument("false", meanings.no) },
  ]
}

/**
 * One forward pass over the candidates, batched so the flattened
 * `[prefix + document]` cell count stays bounded. The batch size is a heuristic
 * on the first row's width; every candidate is padded to the widest row.
 */
async function scoreDocuments(
  ort: OrtLike,
  session: OrtSession,
  prefixIds: number[],
  documents: number[][],
  pad: number,
): Promise<number[][]> {
  const width = Math.max(...documents.map(document => document.length))
  const perRow = prefixIds.length + width
  const batchSize = Math.max(1, Math.floor(MAX_BATCH_CELLS / Math.max(1, perRow)))
  const rows: number[][] = []

  for (let start = 0; start < documents.length; start += batchSize) {
    const chunk = documents.slice(start, start + batchSize)
    // `int64` feeds must be bigint-backed; `int32` ids would silently truncate
    // on any vocabulary above 32767.
    const prefix = BigInt64Array.from(prefixIds, id => BigInt(id))
    const prefixMask = new Uint8Array(prefixIds.length).fill(1)
    const docIds = new BigInt64Array(chunk.length * width)
    const docMask = new Uint8Array(chunk.length * width)
    const owners = new BigInt64Array(chunk.length)

    chunk.forEach((document, row) => {
      const offset = row * width
      for (let i = 0; i < document.length; i += 1) docIds[offset + i] = BigInt(document[i]!)
      docMask.fill(1, offset, offset + document.length)
      for (let i = document.length; i < width; i += 1) docIds[offset + i] = BigInt(pad)
    })

    const outputs = await session.run({
      prefix_ids: new ort.Tensor("int64", prefix, [1, prefixIds.length]),
      prefix_mask: new ort.Tensor("bool", prefixMask, [1, prefixIds.length]),
      doc_ids: new ort.Tensor("int64", docIds, [chunk.length, width]),
      doc_mask: new ort.Tensor("bool", docMask, [chunk.length, width]),
      // Every candidate in the batch shares one prefix and one owner, which is
      // what makes their logits comparable to each other.
      owners: new ort.Tensor("int64", owners, [chunk.length]),
    })

    const tensor = outputs.logits ?? Object.values(outputs)[0]
    if (!tensor) throw new Error("Shared-prefix decision model produced no logits output.")
    const dims = tensor.dims ?? tensor.shape ?? []
    const tasks = dims.length >= 2 ? Number(dims[1]) : 1
    const count = dims.length >= 2 ? Number(dims[0]) : documents.length
    for (let row = 0; row < count; row += 1) {
      const values: number[] = []
      for (let task = 0; task < tasks; task += 1) values.push(Number(tensor.data[row * tasks + task] ?? 0))
      rows.push(values)
    }
  }

  return rows
}

/** `onnxruntime-web` in the browser, `onnxruntime-node` elsewhere. */
async function loadOnnxRuntime(): Promise<OrtLike> {
  const runtime = globalThis as { document?: unknown; window?: unknown }
  const isBrowser = typeof runtime.document !== "undefined" && typeof runtime.window !== "undefined"
  // Runtime-selected specifier over optional peers: a static import would
  // resolve at build time and force one runtime into the browser bundle.
  const specifier = isBrowser ? "onnxruntime-web" : "onnxruntime-node"
  try {
    return (await import(/* @vite-ignore */ specifier)) as OrtLike
  } catch (cause) {
    throw new Error(
      `Decision models need ONNX Runtime. Install the optional peer dependency \`${specifier}\` to run them locally.`,
      { cause },
    )
  }
}

// End of module. Vendor-specific entry points were never published, so no
// compatibility aliases are kept.