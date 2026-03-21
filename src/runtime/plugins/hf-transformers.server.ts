import { env } from "@huggingface/transformers"
import { defineNuxtPlugin, useRuntimeConfig } from "#app"
import { resolveCacheDir } from "../utils"

export default defineNuxtPlugin(() => {
  const runtimeConfig = useRuntimeConfig()
  const localModel = (runtimeConfig.public as { localModel?: { cacheDir?: string; localModelPath?: string } }).localModel

  env.cacheDir = resolveCacheDir(localModel?.cacheDir)
  env.localModelPath = localModel?.localModelPath || "/models/"
  env.allowRemoteModels = true
  env.allowLocalModels = true

  const modelNames = Object.keys((runtimeConfig.public as { localModel?: { models?: Record<string, unknown> } }).localModel?.models || {})
  console.info(
    `[nuxt-local-model] cache ready at ${env.cacheDir}; local path ${env.localModelPath}; models: ${
      modelNames.length ? modelNames.join(", ") : "none configured"
    }`,
  )
})
