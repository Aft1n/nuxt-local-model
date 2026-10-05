import { describe, expect, it, vi } from "vitest"
import { createDecisionSharedPrefixAdapter } from "../../src/runtime/shared/decision-shared-prefix"

const MANIFEST = {
  tasks: ["choice", "noul", "score", "true", "false"],
  model_file: "model.onnx",
  query_length: 64,
  document_length: 16,
  cls_token_id: 1,
  sep_token_id: 2,
  pad_token_id: 0,
}

// Deterministic word-piece-ish ids: word length + 10, so prefix/candidates differ.
const encode = async (text: string) => text.split(/\s+/).filter(Boolean).map(w => (w.length % 50) + 10)

function stubRuntime(logitsFor: (docIndex: number) => number[]) {
  // One session.run call per question; each call returns one row per candidate
  // document in that call (dims [n_docs, tasks]).
  // The stub Tensor below records its dims; doc count is the first dim.
  const run = vi.fn(async (feeds: Record<string, { dims: number[] }>) => {
    const count = feeds.doc_ids.dims[0] ?? 2
    const data: number[] = []
    for (let doc = 0; doc < count; doc += 1) data.push(...logitsFor(doc))
    return {
      logits: { data: Float32Array.from(data), dims: [count, MANIFEST.tasks.length] },
    }
  })
  const create = vi.fn(async () => ({ run }))
  const Tensor = class {
    dims: number[]
    constructor(public type: string, public data: unknown, dims?: number[]) {
      this.dims = dims ?? []
    }
  }
  vi.doMock("onnxruntime-node", () => ({ InferenceSession: { create }, Tensor }))
  return { run, create }
}

async function fetchStub(url: string) {
  const text: Record<string, string> = {
    "manifest.json": JSON.stringify(MANIFEST),
    "tokenizer.json": "{}",
    "tokenizer_config.json": "{}",
  }
  const name = url.split("/").pop()!
  if (name === "model.onnx") {
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }
  if (text[name]) {
    return new Response(text[name], { status: 200 })
  }
  return new Response("missing", { status: 404 })
}

describe("shared-prefix adapter mapping", () => {
  it("answers choice/noul/score from one batched logits table", async () => {
    stubRuntime(() => [3, 0, 0.5, 0, 0])
    const adapter = await createDecisionSharedPrefixAdapter({
      source: "https://example.com/models/triage/",
      encode,
      fetch: (async (url: string | URL | Request) => fetchStub(String(url))) as typeof fetch,
    })

    const result = await adapter.decide({
      state: "charged twice, refund please",
      questions: {
        department: {
          type: "choice",
          instructions: "Which team?",
          criteria: { billing: "invoices", technical: "bugs", other: "rest" },
        },
        refund: { type: "noul", instructions: "Wants refund?", criteria: { true: "asks back", false: "no ask" } },
        urgency: { type: "score", instructions: "How urgent?", criteria: ["0", "1", "2"] },
      },
    })

    expect(result.answers.department?.type).toBe("choice")
    if (result.answers.department?.type !== "choice") throw new Error("choice")
    expect(result.answers.department.choice).toBe("billing")
    expect(result.answers.refund?.type).toBe("noul")
    expect(result.answers.urgency?.type).toBe("score")
  })

  it("throws when the manifest lacks the question type", async () => {
    stubRuntime(() => [0, 0, 0, 0, 0])
    // Manifest without a `score` column: a score question has no task to score on.
    const narrow = { ...MANIFEST, tasks: ["choice", "true", "false"] }
    const adapter = await createDecisionSharedPrefixAdapter({
      source: "https://example.com/models/triage/",
      encode,
      fetch: (async (url: string | URL | Request) => {
        if (String(url).endsWith("manifest.json")) {
          return new Response(JSON.stringify(narrow), { status: 200 })
        }
        return fetchStub(String(url))
      }) as typeof fetch,
    })

    await expect(adapter.decide({
      state: "x",
      questions: { s: { type: "score", instructions: "?", criteria: ["0", "1"] } },
    })).rejects.toThrow(/does not support/)
  })

  it("rejects score levels that are not distinct numbers", async () => {
    const { createDecisionSharedPrefixAdapter: create } = await import("../../src/runtime/shared/decision-shared-prefix")
    expect(create).toBeDefined()
    stubRuntime(() => [0, 0, 0, 0, 0])
    const adapter = await create({
      source: "https://example.com/models/triage/",
      encode,
      fetch: (async (url: string | URL | Request) => fetchStub(String(url))) as typeof fetch,
    })

    await expect(adapter.decide({
      state: "x",
      questions: { s: { type: "score", instructions: "?", criteria: ["low", "high"] } },
    })).rejects.toThrow(/finite number/)
  })

  it("resolves a Hugging Face id to its manifest export directory", async () => {
    stubRuntime(() => [1, 0, 0, 0, 0])
    const seen: string[] = []
    const adapter = await createDecisionSharedPrefixAdapter({
      source: "my-org/my-decision-model",
      encode,
      fetch: (async (url: string | URL | Request) => {
        seen.push(String(url))
        return fetchStub(String(url))
      }) as typeof fetch,
    })

    await adapter.decide({
      state: "x",
      questions: { q: { type: "choice", instructions: "?", criteria: { a: "A", b: "B" } } },
    })

    expect(seen[0]).toBe(
      "https://huggingface.co/my-org/my-decision-model/resolve/main/onnx/manifest.json",
    )
  })

  it("throws a helpful error when manifest.json is missing", async () => {
    stubRuntime(() => [0])
    await expect(createDecisionSharedPrefixAdapter({
      source: "https://example.com/empty/",
      encode,
      fetch: (async () => new Response("no", { status: 404 })) as typeof fetch,
    })).rejects.toThrow(/manifest\.json/)
  })
})
