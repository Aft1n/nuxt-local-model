import type { DecisionQuestion, DecisionQuestionMap, DecisionModelState } from "../types"

/**
 * Jev-style constraints. These bound the answer space before inference, which
 * is the whole point of a decision model: a `choice` can only ever return one
 * of the criteria it was given, and a `score` one of its levels.
 */
const MAX_CHOICE_OPTIONS = 255
const MIN_SCORE_LEVELS = 2
const MAX_SCORE_LEVELS = 10

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function assertDecisionState(state: unknown): asserts state is DecisionModelState {
  const valid = typeof state === "string" || isPlainObject(state) || Array.isArray(state)
  if (!valid) {
    throw new TypeError(
      `Decision model "state" must be a string, object or array; received ${state === null ? "null" : typeof state}.`,
    )
  }
}

export function assertDecisionQuestion(id: string, question: unknown): asserts question is DecisionQuestion {
  if (!isPlainObject(question)) {
    throw new TypeError(`Decision question "${id}" must be an object.`)
  }

  const { type, instructions } = question as { type?: unknown; instructions?: unknown }

  if (typeof instructions !== "string" || !instructions.trim()) {
    throw new TypeError(`Decision question "${id}" must declare non-empty "instructions".`)
  }

  switch (type) {
    case "noul": {
      const { criteria } = question as { criteria?: unknown }
      if (criteria === undefined) return
      if (!isPlainObject(criteria)) {
        throw new TypeError(`Decision question "${id}" of type "noul" may only declare a "criteria" object with "true"/"false" (or "yes"/"no") meanings.`)
      }
      const keys = Object.keys(criteria)
      const allowed = new Set(["true", "false", "yes", "no"])
      const unknown = keys.filter(key => !allowed.has(key))
      if (unknown.length > 0 || keys.length === 0) {
        throw new TypeError(`Decision question "${id}" of type "noul" may only declare "true"/"false" (or "yes"/"no") criteria.`)
      }
      if (Object.values(criteria).some(label => typeof label !== "string" || !label.trim())) {
        throw new TypeError(`Every meaning in decision question "${id}" must be a non-empty string.`)
      }
      return
    }

    case "choice": {
      const { criteria } = question as { criteria?: unknown }
      if (!isPlainObject(criteria)) {
        throw new TypeError(`Decision question "${id}" of type "choice" must declare a "criteria" object.`)
      }

      const options = Object.keys(criteria)
      if (options.length < 2) {
        throw new TypeError(
          `Decision question "${id}" of type "choice" needs at least 2 options; received ${options.length}.`,
        )
      }
      if (options.length > MAX_CHOICE_OPTIONS) {
        throw new TypeError(
          `Decision question "${id}" declares ${options.length} options; the maximum is ${MAX_CHOICE_OPTIONS}.`,
        )
      }
      if (options.some(option => typeof criteria[option] !== "string" || !criteria[option].trim())) {
        throw new TypeError(`Every option in decision question "${id}" must map to a non-empty description.`)
      }
      return
    }

    case "score": {
      const { criteria } = question as { criteria?: unknown }
      if (!Array.isArray(criteria)) {
        throw new TypeError(`Decision question "${id}" of type "score" must declare a "criteria" array.`)
      }
      if (criteria.length < MIN_SCORE_LEVELS || criteria.length > MAX_SCORE_LEVELS) {
        throw new TypeError(
          `Decision question "${id}" must declare between ${MIN_SCORE_LEVELS} and ${MAX_SCORE_LEVELS} levels; received ${criteria.length}.`,
        )
      }
      if (criteria.some(level => typeof level !== "string" || !level.trim())) {
        throw new TypeError(`Every level in decision question "${id}" must be a non-empty string.`)
      }
      return
    }

    default:
      throw new TypeError(
        `Decision question "${id}" has unknown type ${JSON.stringify(type)}; expected "noul", "choice" or "score".`,
      )
  }
}

export function assertDecisionQuestions(questions: unknown): asserts questions is DecisionQuestionMap {
  if (!isPlainObject(questions)) {
    throw new TypeError('Decision model "questions" must be an object mapping ids to questions.')
  }

  const ids = Object.keys(questions)
  if (ids.length === 0) {
    throw new TypeError("Decision model requires at least one question.")
  }

  for (const id of ids) {
    assertDecisionQuestion(id, questions[id])
  }
}
