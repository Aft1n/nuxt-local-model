import { describe, expect, it } from "vitest"
import {
  assertDecisionQuestion,
  assertDecisionQuestions,
  assertDecisionState,
} from "../../src/runtime/shared/decision-validate"
import { resolveDecisionModelDefinition } from "../../src/runtime/utils"

describe("decision model configuration", () => {
  it("resolves a registered decision model", () => {
    const definition = resolveDecisionModelDefinition("triage", {
      decisionModels: {
        triage: { source: "./models/triage", outputMap: { logits: "refund" } },
      },
    })

    expect(definition.source).toBe("./models/triage")
    expect(definition.outputMap).toEqual({ logits: "refund" })
  })

  it("throws when the decision model is not registered", () => {
    expect(() => resolveDecisionModelDefinition("missing", { decisionModels: {} }))
      .toThrow('Decision model "missing" is not defined in nuxt.config.')
  })

  it("throws when no decision models are configured at all", () => {
    expect(() => resolveDecisionModelDefinition("triage", {}))
      .toThrow('Decision model "triage" is not defined in nuxt.config.')
  })

  it("rejects an entry without a usable source", () => {
    expect(() =>
      resolveDecisionModelDefinition("triage", { decisionModels: { triage: { source: "   " } } }),
    ).toThrow('Decision model "triage" must declare a non-empty "source" in nuxt.config.')
  })

  it("lets a per-call source override the configured one", () => {
    const definition = resolveDecisionModelDefinition(
      "triage",
      { decisionModels: { triage: { source: "./models/default" } } },
      { source: "./models/override" },
    )

    expect(definition.source).toBe("./models/override")
  })
})

describe("decision model state validation", () => {
  it("accepts the three documented state shapes", () => {
    expect(() => assertDecisionState("a message")).not.toThrow()
    expect(() => assertDecisionState({ incident: "leak" })).not.toThrow()
    expect(() => assertDecisionState(["a", "b"])).not.toThrow()
  })

  it("rejects null and primitives", () => {
    expect(() => assertDecisionState(null)).toThrow(TypeError)
    expect(() => assertDecisionState(42)).toThrow(TypeError)
    expect(() => assertDecisionState(true)).toThrow(TypeError)
  })
})

describe("decision question validation", () => {
  it("accepts a well-formed noul question", () => {
    expect(() =>
      assertDecisionQuestion("refund", { type: "noul", instructions: "Does the user want a refund?" }),
    ).not.toThrow()
  })

  it("accepts a well-formed choice question", () => {
    expect(() =>
      assertDecisionQuestion("team", {
        type: "choice",
        instructions: "Which team handles this?",
        criteria: { billing: "invoices", other: "everything else" },
      }),
    ).not.toThrow()
  })

  it("accepts a well-formed score question", () => {
    expect(() =>
      assertDecisionQuestion("urgency", {
        type: "score",
        instructions: "How urgent is this?",
        criteria: ["not urgent", "soon", "blocking"],
      }),
    ).not.toThrow()
  })

  it("requires instructions on every question", () => {
    expect(() => assertDecisionQuestion("refund", { type: "noul", instructions: "  " }))
      .toThrow('Decision question "refund" must declare non-empty "instructions".')
  })

  it("rejects an unknown question type", () => {
    expect(() => assertDecisionQuestion("weird", { type: "sentiment", instructions: "How?" }))
      .toThrow(/unknown type "sentiment"/)
  })

  it("requires at least two choice options", () => {
    expect(() =>
      assertDecisionQuestion("team", {
        type: "choice",
        instructions: "Which team?",
        criteria: { only: "the sole option" },
      }),
    ).toThrow('Decision question "team" of type "choice" needs at least 2 options; received 1.')
  })

  it("rejects choice options without descriptions", () => {
    expect(() =>
      assertDecisionQuestion("team", {
        type: "choice",
        instructions: "Which team?",
        criteria: { billing: "invoices", other: "  " },
      }),
    ).toThrow('Every option in decision question "team" must map to a non-empty description.')
  })

  it("bounds choice options at 255", () => {
    const criteria: Record<string, string> = {}
    for (let i = 0; i < 256; i += 1) criteria[`opt${i}`] = `option ${i}`

    expect(() =>
      assertDecisionQuestion("wide", { type: "choice", instructions: "Which?", criteria }),
    ).toThrow('Decision question "wide" declares 256 options; the maximum is 255.')
  })

  it("bounds score levels to 2..10", () => {
    expect(() =>
      assertDecisionQuestion("s", { type: "score", instructions: "Where?", criteria: ["only"] }),
    ).toThrow('Decision question "s" must declare between 2 and 10 levels; received 1.')

    const tooMany = Array.from({ length: 11 }, (_, i) => `level ${i}`)
    expect(() =>
      assertDecisionQuestion("s", { type: "score", instructions: "Where?", criteria: tooMany }),
    ).toThrow('Decision question "s" must declare between 2 and 10 levels; received 11.')
  })

  it("requires a criteria array for score questions", () => {
    expect(() =>
      assertDecisionQuestion("s", { type: "score", instructions: "Where?", criteria: { a: "b" } }),
    ).toThrow('Decision question "s" of type "score" must declare a "criteria" array.')
  })

  it("requires at least one question in a request", () => {
    expect(() => assertDecisionQuestions({})).toThrow("Decision model requires at least one question.")
    expect(() => assertDecisionQuestions([])).toThrow('Decision model "questions" must be an object')
  })

  it("names the offending question id when validating a map", () => {
    expect(() =>
      assertDecisionQuestions({
        good: { type: "noul", instructions: "ok" },
        bad: { type: "choice", instructions: "no criteria" },
      }),
    ).toThrow('Decision question "bad" of type "choice" must declare a "criteria" object.')
  })
})
