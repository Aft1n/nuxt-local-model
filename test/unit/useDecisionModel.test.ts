import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DecisionModelAdapter, DecisionRequest } from "../../src/runtime/types"
import { resetDecisionModelCache, useDecisionModel } from "../../src/runtime/composables/useDecisionModel"

const { useRuntimeConfig } = vi.hoisted(() => ({
  useRuntimeConfig: vi.fn(() => ({
    public: {
      localModel: {
        decisionModels: {
          triage: { source: "./models/triage" },
        },
      },
    },
  })),
}))

vi.mock("nuxt/app", () => ({ useRuntimeConfig }))

function stubAdapter(logitsByQuestion: Record<string, number[]>): DecisionModelAdapter {
  return {
    decide: vi.fn(async (request: DecisionRequest) => {
      const answers: Record<string, unknown> = {}
      for (const [id, question] of Object.entries(request.questions)) {
        const logits = logitsByQuestion[id] ?? [0, 0]
        if (question.type === "choice") {
          const options = Object.keys(question.criteria)
          const exps = logits.slice(0, options.length).map(value => Math.exp(value))
          const total = exps.reduce((sum, value) => sum + value, 0)
          const probabilities = Object.fromEntries(
            options.map((option, index) => [option, (exps[index] ?? 0) / total]),
          )
          const winner = options[probabilities[options[0]] >= probabilities[options[options.length - 1]] ? 0 : options.length - 1]
          answers[id] = { type: "choice", choice: winner, probabilities, confidence: probabilities[winner] }
        } else {
          answers[id] = { type: question.type, noul: 1 / (1 + Math.exp(-(logits[0] ?? 0))) }
        }
      }
      return { answers: answers as never }
    }),
  }
}

describe("useDecisionModel", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetDecisionModelCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves the registered definition and returns a judge", async () => {
    const adapter = stubAdapter({})
    const judge = await useDecisionModel("triage", { adapter: () => adapter })

    expect(judge.definition.source).toBe("./models/triage")
    expect(typeof judge.decide).toBe("function")
  })

  it("throws for an unregistered decision model", async () => {
    await expect(useDecisionModel("nope", { adapter: () => stubAdapter({}) })).rejects.toThrow(
      'Decision model "nope" is not defined in nuxt.config.',
    )
  })

  it("passes the state and questions through to the adapter", async () => {
    const adapter = stubAdapter({ refund: [4] })
    const judge = await useDecisionModel("triage", { adapter: () => adapter, reload: true })

    const request: DecisionRequest = {
      state: "charged twice, refund please",
      questions: { refund: { type: "noul", instructions: "Does the user want a refund?" } },
    }
    const result = await judge.decide(request)

    expect(adapter.decide).toHaveBeenCalledWith(request, undefined)
    expect(result.answers.refund).toMatchObject({ type: "noul" })
  })

  it("forwards per-call decide options", async () => {
    const adapter = stubAdapter({ refund: [1] })
    const judge = await useDecisionModel("triage", { adapter: () => adapter, reload: true })
    const controller = new AbortController()

    await judge.decide(
      { state: "x", questions: { refund: { type: "noul", instructions: "refund?" } } },
      { signal: controller.signal },
    )

    expect(adapter.decide).toHaveBeenCalledWith(expect.anything(), {
      signal: controller.signal,
    })
  })

  it("reuses one adapter across calls for the same definition", async () => {
    const factory = vi.fn(() => stubAdapter({}))
    const first = await useDecisionModel("triage", { adapter: factory })
    await first.decide({ state: "a", questions: { q: { type: "noul", instructions: "q?" } } })
    const second = await useDecisionModel("triage", { adapter: factory })

    expect(second).toBeDefined()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it("bypasses the cache when reload is requested", async () => {
    const factory = vi.fn(() => stubAdapter({}))
    await useDecisionModel("triage", { adapter: factory })
    await useDecisionModel("triage", { adapter: factory, reload: true })

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("does not cache a rejected load so the next call retries", async () => {
    const factory = vi
      .fn<() => DecisionModelAdapter>()
      .mockImplementationOnce(() => {
        throw new Error("missing weights")
      })
      .mockImplementationOnce(() => stubAdapter({}))

    await expect(useDecisionModel("triage", { adapter: factory })).rejects.toThrow("missing weights")

    const recovered = await useDecisionModel("triage", { adapter: factory })
    expect(recovered).toBeDefined()
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("releases the session and evicts the cache on dispose", async () => {
    const dispose = vi.fn()
    const factory = () => ({ decide: vi.fn(), dispose })

    const judge = await useDecisionModel("triage", { adapter: factory })
    await judge.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it("keeps a shared session alive until its last holder disposes", async () => {
    const dispose = vi.fn()
    const factory = vi.fn(() => ({ decide: vi.fn(), dispose }))

    const first = await useDecisionModel("triage", { adapter: factory })
    const second = await useDecisionModel("triage", { adapter: factory })
    await first.dispose()

    expect(dispose).not.toHaveBeenCalled()
    const reloaded = await useDecisionModel("triage", { adapter: factory })
    expect(factory).toHaveBeenCalledTimes(1)
    await second.dispose()
    await reloaded.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("makes dispose idempotent per handle", async () => {
    const dispose = vi.fn()
    const factory = () => ({ decide: vi.fn(), dispose })

    const judge = await useDecisionModel("triage", { adapter: factory })
    await judge.dispose()
    await judge.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("keeps a superseded session usable for its holder after reload", async () => {
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const factory = vi.fn()
      .mockImplementationOnce(() => ({ decide: vi.fn(), dispose: firstDispose }))
      .mockImplementationOnce(() => ({ decide: vi.fn(), dispose: secondDispose }))

    const old = await useDecisionModel("triage", { adapter: factory })
    const fresh = await useDecisionModel("triage", { adapter: factory, reload: true })
    await old.dispose()

    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(secondDispose).not.toHaveBeenCalled()
    await fresh.dispose()

    expect(secondDispose).toHaveBeenCalledTimes(1)
  })
})
