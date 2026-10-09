import { getDecisionModel } from "../../../src/runtime/server"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ state?: string }>(event).catch(() => ({ state: "" }))
  const state = (body.state || "").trim()
  if (!state) {
    throw createError({ statusCode: 400, statusMessage: "state text is required" })
  }

  const bekko = await getDecisionModel("bekko")

  const result = await bekko.decide({
    state,
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle this request?",
        criteria: {
          billing: "invoices, payments, charges and refunds",
          technical: "bugs, outages and configuration problems",
          sales: "upgrades, pricing questions and new purchases",
          other: "everything else",
        },
      },
      wants_refund: {
        type: "noul",
        instructions: "Is the customer asking for their money back?",
      },
    },
  })

  return { state, answers: result.answers, usage: result.usage }
})
