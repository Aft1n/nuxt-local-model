import { defineNuxtPlugin, useRuntimeConfig } from "nuxt/app"
import { applyLocalModelEnvironment, resolveRuntimeConfig } from "../utils"

export default defineNuxtPlugin(() => {
  const runtimeConfig = useRuntimeConfig()
  const localModel = resolveRuntimeConfig((runtimeConfig.public as { localModel?: Record<string, unknown> }).localModel as any)

  applyLocalModelEnvironment({
    cacheDir: localModel.cacheDir,
    allowRemoteModels: localModel.allowRemoteModels,
    allowLocalModels: false,
  })
})
