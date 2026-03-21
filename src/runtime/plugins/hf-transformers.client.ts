import { env } from "@huggingface/transformers"
import { defineNuxtPlugin, useRuntimeConfig } from "#app"
import { resolveCacheDir } from "../utils"

export default defineNuxtPlugin(() => {
  const runtimeConfig = useRuntimeConfig()
  const localModel = (runtimeConfig.public as { localModel?: { cacheDir?: string; localModelPath?: string } }).localModel

  env.cacheDir = resolveCacheDir(localModel?.cacheDir)
  env.localModelPath = localModel?.localModelPath || "/models/"
  env.allowRemoteModels = true
  env.allowLocalModels = false

  console.info(`[nuxt-local-model] browser cache ready at ${env.cacheDir}`)
})
