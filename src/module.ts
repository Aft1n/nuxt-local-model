/// <reference path="./runtime/nuxt.d.ts" />
import { defineNuxtModule, addImports, addPlugin, createResolver } from "@nuxt/kit"
import { existsSync } from "node:fs"
import type { LocalModelRuntimeConfig } from "./runtime/types"
import { setLocalModelRuntimeConfig } from "./runtime/shared/local-model"

export interface NuxtLlmModuleOptions extends LocalModelRuntimeConfig {}

export default defineNuxtModule<NuxtLlmModuleOptions>().with({
  meta: {
    name: "nuxt-local-model",
    configKey: "localModel",
  },
  defaults: {
    runtime: "auto",
    cacheDir: "./.ai-models",
    allowRemoteModels: true,
    allowLocalModels: true,
    defaultTask: "feature-extraction",
    serverWorker: false,
    browserWorker: false,
    models: {},
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const serverWorkerJs = resolve("./runtime/server/worker.js")
    const serverWorkerTs = resolve("./runtime/server/worker.ts")
    const serverWorkerEntry = existsSync(serverWorkerJs) ? serverWorkerJs : serverWorkerTs
    setLocalModelRuntimeConfig({
      ...options,
      serverWorkerEntry,
    })

    nuxt.options.runtimeConfig.public ||= {}
    ;(nuxt.options.runtimeConfig.public as { localModel?: Record<string, unknown> }).localModel = {
      cacheDir: options.cacheDir,
      allowRemoteModels: options.allowRemoteModels,
      allowLocalModels: options.allowLocalModels,
      runtime: options.runtime,
      defaultTask: options.defaultTask,
      serverWorker: options.serverWorker,
      serverWorkerEntry,
      browserWorker: options.browserWorker,
      models: options.models,
    }

    addImports({
      name: "useLocalModel",
      from: resolve("./runtime/composables/useLocalModel"),
    })

    addPlugin({
      src: resolve("./runtime/plugins/hf-transformers.server"),
    })

    addPlugin({
      src: resolve("./runtime/plugins/hf-transformers.client"),
      mode: "client",
    })

    nuxt.hook("ready", async () => {
      const modelNames = Object.keys(options.models || {})
      if (modelNames.length === 0) return
      const { loadLocalModel } = await import("./runtime/shared/local-model")
      const results = await Promise.allSettled(modelNames.map((name) => loadLocalModel(name, options)))
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const name = modelNames[index]
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
          console.warn(`[nuxt-local-model] failed to warm model "${name}" during startup: ${reason}`)
        }
      })
    })
  },
})
