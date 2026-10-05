import { getDecisionModel } from "../../../src/runtime/server"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ state?: string }>(event).catch(() => ({ state: "" }))
  const state = body.state || "We were billed twice for March. Please refund the duplicate."

  // The module's Nitro plugin populates the server-side config store, so this
  // resolves the adapter without needing the (redacted) public copy.
  const triage = await getDecisionModel("triage")

  const result = await triage.decide({
    state,
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: {
          billing: "invoices, payments and refunds",
          technical: "bugs, outages and integration problems",
          other: "everything else",
        },
      },
      urgency: {
        type: "score",
        instructions: "How urgent does this look?",
        criteria: ["not urgent", "soon", "blocking"],
      },
      wants_refund: {
        type: "noul",
        instructions: "Does the user explicitly ask for a refund?",
      },
    },
  })

  return { state, answers: result.answers, usage: result.usage }
})
