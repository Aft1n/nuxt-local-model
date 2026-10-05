import type { LocalModelConfig } from "./types"

export function defineLocalModelConfig<const T extends LocalModelConfig>(config: T) {
  return config
}

export type { LocalModelAliases } from "./types"
export type {
  DecisionAnswer,
  DecisionAnswers,
  DecisionChoiceAnswer,
  DecisionChoiceQuestion,
  DecisionDecideOptions,
  DecisionModelAdapter,
  DecisionModelDefinition,
  DecisionModelLoadOptions,
  DecisionNoulAnswer,
  DecisionNoulQuestion,
  DecisionModelState,
  DecisionQuestion,
  DecisionQuestionMap,
  DecisionRequest,
  DecisionResult,
  DecisionScoreAnswer,
  DecisionScoreQuestion,
} from "./types"

export type { DecisionModel, UseDecisionModelOptions } from "./composables/useDecisionModel"
