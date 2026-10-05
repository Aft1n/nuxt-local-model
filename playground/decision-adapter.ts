import type {
  DecisionAnswer,
  DecisionAnswers,
  DecisionModelAdapter,
  DecisionModelLoadOptions,
  DecisionRequest,
  DecisionResult,
} from "../src/runtime/types"

/**
 * A deterministic stand-in for a real ONNX decision engine, used by the
 * playground so the decision-model flow can be exercised without downloading
 * model weights. It is NOT inference: values come from a stable string hash, so
 * the same state and questions always produce the same answer.
 *
 * Playground-only. Swap `decisionModels.triage.adapter` for a real engine to
 * run genuine inference.
 */

/** FNV-1a, so a given string always hashes to the same 32-bit value. */
function hashText(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Maps a hash into 0..1. */
function unitValue(text: string): number {
  return hashText(text) / 0xffffffff
}

/** Turns raw weights into a probability distribution summing to 1. */
function normalize(weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (weights.length === 0 || total === 0) {
    return weights.map(() => (weights.length === 0 ? 0 : 1 / weights.length))
  }
  return weights.map(weight => weight / total)
}

export function createPlaygroundDecisionAdapter(
  _options: DecisionModelLoadOptions,
): DecisionModelAdapter {
  return {
    async decide(request: DecisionRequest): Promise<DecisionResult> {
      const state = typeof request.state === "string" ? request.state : JSON.stringify(request.state)
      const answers: DecisionAnswers = {}

      for (const [id, question] of Object.entries(request.questions)) {
        const seed = `${state}::${id}::${question.instructions}`

        if (question.type === "choice") {
          const options = Object.keys(question.criteria)
          const probabilities = normalize(options.map(option => unitValue(`${seed}::${option}`) + 0.001))
          const winner = options.reduce((best, option, index) =>
            probabilities[index] > probabilities[options.indexOf(best)] ? option : best,
          )
          const answer: DecisionAnswer = {
            type: "choice",
            choice: winner,
            probabilities: Object.fromEntries(options.map((option, index) => [option, probabilities[index]])),
            confidence: probabilities[options.indexOf(winner)],
          }
          answers[id] = answer
          continue
        }

        if (question.type === "score") {
          const levels = question.criteria
          const probabilities = normalize(levels.map((_, index) => unitValue(`${seed}::${index}`) + 0.001))
          const score = probabilities.reduce((sum, probability, index) => sum + probability * index, 0)
          const answer: DecisionAnswer = {
            type: "score",
            score,
            probabilities: Object.fromEntries(levels.map((_, index) => [String(index), probabilities[index]])),
            confidence: Math.max(...probabilities),
            legend: Object.fromEntries(levels.map((level, index) => [String(index), level])),
          }
          answers[id] = answer
          continue
        }

        const answer: DecisionAnswer = { type: "noul", noul: unitValue(seed) }
        answers[id] = answer
      }

      return {
        answers,
        usage: { stateTokens: state.length, truncated: false },
      }
    },
  }
}

export default createPlaygroundDecisionAdapter
