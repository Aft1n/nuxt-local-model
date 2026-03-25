import { defineNuxtPlugin, useRuntimeConfig } from "nuxt/app"
import { applyLocalModelEnvironment, type InternalLocalModelRuntimeConfig, resolveRuntimeConfig } from "../utils"

function resolvePrewarmTargets(prewarm: boolean | string[], models: Record<string, unknown>) {
  if (prewarm === true) return Object.keys(models)
  if (Array.isArray(prewarm)) return prewarm
  return []
}

export default defineNuxtPlugin(async (nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const publicRuntimeConfig = runtimeConfig.public as { localModel?: InternalLocalModelRuntimeConfig }
  const localModel = resolveRuntimeConfig(publicRuntimeConfig.localModel)

  await applyLocalModelEnvironment({
    cacheDir: localModel.cacheDir,
    allowRemoteModels: localModel.allowRemoteModels,
    allowLocalModels: false,
  })

  const targets = resolvePrewarmTargets(localModel.browserPrewarm, localModel.models)
    .filter(name => name in (localModel.models || {}))

  if (!targets.length) return

  nuxtApp.hook("app:mounted", () => {
    const schedule = typeof window !== "undefined" && "requestIdleCallback" in window
      ? (callback: () => void) => (window as Window & { requestIdleCallback: (cb: () => void, options?: { timeout: number }) => number })
          .requestIdleCallback(callback, { timeout: 1500 })
      : (callback: () => void) => window.setTimeout(callback, 0)

    schedule(() => {
      void import("../composables/useLocalModel").then(async ({ prewarmLocalModel }) => {
        const results = await Promise.allSettled(targets.map(name => prewarmLocalModel(name)))
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
            console.warn(`[nuxt-local-model] failed to browser-prewarm model "${targets[index]}": ${reason}`)
          }
        })
      })
    })
  })
})
