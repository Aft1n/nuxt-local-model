import { describe, expect, it, vi } from "vitest"
import { createDecisionOnnxAdapter } from "../../src/runtime/shared/decision-onnx"

const { run, create } = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(),
}))

vi.mock("onnxruntime-node", () => ({
  InferenceSession: { create },
  Tensor: class {},
}))

interface StubTensor {
  data: number[]
  dims?: number[]
}

function stubOutputs(outputs: Record<string, StubTensor | number[]>) {
  create.mockResolvedValue({ run })
  run.mockResolvedValue(
    Object.fromEntries(
      Object.entries(outputs).map(([name, tensor]) => [
        name,
        Array.isArray(tensor)
          ? { data: Float32Array.from(tensor) }
          : { data: Float32Array.from(tensor.data), ...(tensor.dims ? { dims: tensor.dims } : {}) },
      ]),
    ),
  )
}

const encode = vi.fn(async (text: string) => ({
  input_ids: { data: Float32Array.from([1, 2, 3]), dims: [1, 3] },
  attention_mask: { data: Float32Array.from([1, 1, 1]), dims: [1, 3] },
}))

async function createAdapter(
  outputs: Record<string, StubTensor | number[]>,
  options: Partial<Parameters<typeof createDecisionOnnxAdapter>[0]> = {},
) {
  stubOutputs(outputs)
  return createDecisionOnnxAdapter({ source: "./model", encode, ...options })
}

describe("decision ONNX adapter", () => {
  it("turns a choice logit vector into a normalised distribution with a winner", async () => {
    const adapter = await createAdapter({ department: [2, 0.5, -1] })

    const result = await adapter.decide({
      state: "charged twice",
      questions: {
        department: {
          type: "choice",
          instructions: "Which team?",
          criteria: { billing: "invoices", technical: "bugs", other: "rest" },
        },
      },
    })

    const answer = result.answers.department
    expect(answer?.type).toBe("choice")
    if (answer?.type !== "choice") throw new Error("expected a choice answer")

    expect(answer.choice).toBe("billing")

    const total = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(Object.keys(answer.probabilities)).toEqual(["billing", "technical", "other"])
    // Confidence is entropy-based (1 - H(p)/ln(N)), so it sits below the
    // winning probability: 0.4342 for this distribution vs 0.7856 max-prob.
    expect(answer.confidence).toBeCloseTo(0.43420931015358866, 6)
    expect(answer.confidence).toBeLessThan(answer.probabilities.billing ?? 1)
  })

  it("computes a probability-weighted score and echoes the legend", async () => {
    const adapter = await createAdapter({ urgency: [0, 2, 0] })

    const result = await adapter.decide({
      state: "production is down",
      questions: {
        urgency: {
          type: "score",
          instructions: "How urgent?",
          criteria: ["not urgent", "soon", "blocking"],
        },
      },
    })

    const answer = result.answers.urgency
    if (answer?.type !== "score") throw new Error("expected a score answer")

    // Mass concentrates on level 1, so the score sits just above 1.
    expect(answer.score).toBeGreaterThan(0.9)
    expect(answer.score).toBeLessThan(1.1)
    expect(answer.legend).toEqual({ "0": "not urgent", "1": "soon", "2": "blocking" })
    // softmax([0, 2, 0]) -> [0.1065, 0.7870, 0.1065]; entropy confidence
    // 0.3942, below the 0.7870 max probability.
    expect(answer.confidence).toBeCloseTo(0.3941696367645886, 6)
  })

  it("maps a single logit through a sigmoid for noul", async () => {
    const adapter = await createAdapter({ wants_refund: [0] })
    const neutral = await adapter.decide({
      state: "hello",
      questions: { wants_refund: { type: "noul", instructions: "refund?" } },
    })
    expect(neutral.answers.wants_refund?.type === "noul" && neutral.answers.wants_refund.noul)
      .toBeCloseTo(0.5, 5)

    stubOutputs({ wants_refund: [10] })
    const confident = await adapter.decide({
      state: "refund now",
      questions: { wants_refund: { type: "noul", instructions: "refund?" } },
    })
    const value = confident.answers.wants_refund
    if (value?.type !== "noul") throw new Error("expected a noul answer")
    expect(value.noul).toBeGreaterThan(0.99)
  })

  it("answers every question from one forward pass", async () => {
    const adapter = await createAdapter({ a: [1], b: [0, 3] })

    const result = await adapter.decide({
      state: "a ticket",
      questions: {
        a: { type: "noul", instructions: "a?" },
        b: { type: "choice", instructions: "b?", criteria: { x: "first", y: "second" } },
      },
    })

    expect(Object.keys(result.answers).sort()).toEqual(["a", "b"])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("feeds the encoded state into the session", async () => {
    const adapter = await createAdapter({ a: [0] })
    await adapter.decide({
      state: "some text",
      questions: { a: { type: "noul", instructions: "a?" } },
    })

    expect(encode).toHaveBeenCalledWith("some text")
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input_ids: expect.anything(), attention_mask: expect.anything() }),
    )
  })

  it("ignores session outputs that map to no question", async () => {
    const adapter = await createAdapter({ a: [1], stray: [0] })

    const result = await adapter.decide({
      state: "x",
      questions: { a: { type: "noul", instructions: "a?" } },
    })

    expect(Object.keys(result.answers)).toEqual(["a"])
  })

  it("maps a differently named output through outputMap", async () => {
    // `logits` matches no question id, so outputMap routes it to `b`.
    // Higher logit on the first entry, so `yes` wins.
    const adapter = await createAdapter({ logits: [4, 0] }, { outputMap: { logits: "b" } })

    const result = await adapter.decide({
      state: "x",
      questions: {
        b: { type: "choice", instructions: "b?", criteria: { yes: "first", no: "second" } },
      },
    })

    const answer = result.answers.b
    if (answer?.type !== "choice") throw new Error("expected a choice answer")
    expect(answer.choice).toBe("yes")
  })

  it("falls back to the lone question when one output has an unrelated name", async () => {
    const adapter = await createAdapter({ head: [3, 0] })

    const result = await adapter.decide({
      state: "x",
      questions: {
        dept: { type: "choice", instructions: "?", criteria: { a: "first", b: "second" } },
      },
    })

    const answer = result.answers.dept
    if (answer?.type !== "choice") throw new Error("expected a choice answer")
    expect(answer.choice).toBe("a")
  })

  it("throws naming both sides when no output matches any question", async () => {
    const adapter = await createAdapter({ logits: [1, 2], choice_0: [3] })

    await expect(adapter.decide({
      state: "x",
      questions: {
        department: { type: "noul", instructions: "?" },
        urgency: { type: "noul", instructions: "?" },
      },
    })).rejects.toThrow(
      /Session output names: "logits", "choice_0"\. Requested question ids: "department", "urgency"/,
    )
  })

  it("reads a [1, N] head from its last axis like a flat vector", async () => {
    const adapter = await createAdapter({ a: { data: [2, 0.5, -1], dims: [1, 3] } })

    const result = await adapter.decide({
      state: "x",
      questions: {
        department: {
          type: "choice",
          instructions: "?",
          criteria: { billing: "invoices", technical: "bugs", other: "rest" },
        },
      },
    })

    const answer = result.answers.department
    if (answer?.type !== "choice") throw new Error("expected a choice answer")
    expect(answer.choice).toBe("billing")
    // Identical distribution to the flat softmax([2, 0.5, -1]) case.
    expect(answer.confidence).toBeCloseTo(0.43420931015358866, 6)
  })

  it("slices an over-wide head down to the declared options", async () => {
    // A 5-wide head whose 4th/5th logits would win if they were kept.
    const adapter = await createAdapter({ a: [0, 0, 0, 9, 9] })

    const result = await adapter.decide({
      state: "x",
      questions: {
        dept: {
          type: "choice",
          instructions: "?",
          criteria: { x: "first", y: "second", z: "third" },
        },
      },
    })

    const answer = result.answers.dept
    if (answer?.type !== "choice") throw new Error("expected a choice answer")
    expect(Object.keys(answer.probabilities)).toEqual(["x", "y", "z"])
    // Ties at 0 survive the slice, so argmax keeps the first declared option.
    expect(answer.choice).toBe("x")
    const total = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it("pads an under-wide head so every declared option keeps a probability", async () => {
    const adapter = await createAdapter({ a: [2, 1] })

    const result = await adapter.decide({
      state: "x",
      questions: {
        dept: {
          type: "choice",
          instructions: "?",
          criteria: { x: "first", y: "second", z: "third", w: "fourth" },
        },
      },
    })

    const answer = result.answers.dept
    if (answer?.type !== "choice") throw new Error("expected a choice answer")
    expect(Object.keys(answer.probabilities)).toEqual(["x", "y", "z", "w"])
    const total = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 5)
    // Zero-padded slots are neutral, not absent: still strictly positive mass.
    expect(answer.probabilities.w ?? 0).toBeGreaterThan(0)
  })

  it("reports state tokens and truncation only when determinable", async () => {
    const untruncated = await createAdapter({ a: [0] })
    const plain = await untruncated.decide({
      state: "x",
      questions: { a: { type: "noul", instructions: "a?" } },
    })
    expect(plain.usage).toEqual({ stateTokens: 3 })

    const bounded = await createAdapter({ a: [0] }, { maxTokens: 3 })
    const clamped = await bounded.decide({
      state: "x",
      questions: { a: { type: "noul", instructions: "a?" } },
    })
    expect(clamped.usage).toEqual({ stateTokens: 3, truncated: true })

    const shapeless = vi.fn(async () => ({ input_ids: { data: [1, 2, 3] } }))
    stubOutputs({ a: [0] })
    const unknown = await createDecisionOnnxAdapter({ source: "./model", encode: shapeless })
    const result = await unknown.decide({
      state: "x",
      questions: { a: { type: "noul", instructions: "a?" } },
    })
    expect(result.usage).toBeUndefined()
  })

  it("defaults the session to CPU but lets sessionOptions override it", async () => {
    await createAdapter({ a: [0] })
    expect(create).toHaveBeenCalledWith("./model", { executionProviders: ["cpu"] })

    create.mockClear()
    await createAdapter({ a: [0] }, { sessionOptions: { executionProviders: ["webgpu"], graphOptimizationLevel: "all" } })
    expect(create).toHaveBeenCalledWith("./model", {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    })
  })

  it("serialises non-string state before encoding", async () => {
    const adapter = await createAdapter({ a: [0] })
    await adapter.decide({
      state: { incident: "leak", severity: 3 },
      questions: { a: { type: "noul", instructions: "a?" } },
    })

    expect(encode).toHaveBeenCalledWith(JSON.stringify({ incident: "leak", severity: 3 }))
  })

  it("rejects a malformed request before touching ONNX", async () => {
    const adapter = await createAdapter({ a: [0] })

    await expect(
      adapter.decide({
        state: "x",
        questions: { bad: { type: "choice", instructions: "needs criteria" } } as never,
      }),
    ).rejects.toThrow(
      'Decision question "bad" of type "choice" must declare a "criteria" object.',
    )

    expect(run).not.toHaveBeenCalled()
  })

  it("surfaces the loader error when the model cannot be opened", async () => {
    create.mockRejectedValue(new Error("model file not found"))

    await expect(createDecisionOnnxAdapter({ source: "./missing", encode })).rejects.toThrow(
      "model file not found",
    )
  })
})
