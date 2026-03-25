import type { FeatureExtractionPipelineType } from "@huggingface/transformers"
import { useLocalModel } from "#imports"
import { getLocalModel } from "nuxt-local-model/server"
import type { LocalModelTaskForName } from "nuxt-local-model"

async function verifyAliasAwareTypes() {
  const browserEmbedder = await useLocalModel("embedding", {
    normalize: true,
    pooling: "mean",
  })
  const serverEmbedder = await getLocalModel("embedding", {
    normalize: true,
    pooling: "mean",
  })

  const browserTyped: FeatureExtractionPipelineType = browserEmbedder
  const serverTyped: FeatureExtractionPipelineType = serverEmbedder
  const embeddingTask: LocalModelTaskForName<"embedding"> = "feature-extraction"

  void browserTyped
  void serverTyped
  void embeddingTask

  // @ts-expect-error feature extraction does not accept text-classification style options
  await useLocalModel("embedding", { top_k: 5 })
}

void verifyAliasAwareTypes()
