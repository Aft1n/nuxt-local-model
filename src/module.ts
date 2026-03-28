import type {} from "./runtime/nuxt"
import { defineNuxtModule, addImports, addPlugin, addTypeTemplate, createResolver } from "@nuxt/kit"
import { existsSync } from "node:fs"
import type { NuxtModule } from "@nuxt/schema"
import type { LocalModelRuntimeConfig } from "./runtime/types"
import { setLocalModelRuntimeConfig } from "./runtime/shared/local-model"

type LocalModelPublicRuntimeConfig = LocalModelRuntimeConfig & {
  serverWorkerEntry?: string
}

export type NuxtLlmModuleOptions = LocalModelRuntimeConfig

function resolvePrewarmTargets(prewarm: boolean | string[], models: Record<string, unknown>) {
  if (prewarm === true) return Object.keys(models)
  if (Array.isArray(prewarm)) return prewarm
  return []
}

function renderLocalModelRegistry(options: LocalModelRuntimeConfig) {
  const defaultTask = options.defaultTask || "feature-extraction"
  const entries = Object.entries(options.models || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alias, definition]) => {
      const task = definition?.task || defaultTask
      return `    ${JSON.stringify(alias)}: ${JSON.stringify(task)}`
    })

  const body = entries.length > 0 ? `\n${entries.join("\n")}\n` : "\n"

  return `declare global {
  interface NuxtLocalModelRegistry {${body}  }
}

export {}
`
}

const module: NuxtModule<NuxtLlmModuleOptions, NuxtLlmModuleOptions, false> = defineNuxtModule<NuxtLlmModuleOptions>({
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
    serverPrewarm: false,
    serverWorker: false,
    browserWorker: false,
    browserPrewarm: false,
    models: {},
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const serverWorkerJs = resolve("./runtime/server/worker.js")
    const serverWorkerTs = resolve("./runtime/server/worker.ts")
    const serverWorkerEntry = existsSync(serverWorkerJs) ? serverWorkerJs : serverWorkerTs

    if (options.browserWorker) {
      nuxt.options.vite ||= {}
      nuxt.options.vite.worker ||= {}
      nuxt.options.vite.worker.format ||= "es"
    }

    setLocalModelRuntimeConfig({
      ...options,
      serverWorkerEntry,
    })

    const publicRuntimeConfig = nuxt.options.runtimeConfig.public as Record<string, unknown> & {
      localModel?: LocalModelPublicRuntimeConfig
    }
    publicRuntimeConfig.localModel = {
      cacheDir: options.cacheDir,
      allowRemoteModels: options.allowRemoteModels,
      allowLocalModels: options.allowLocalModels,
      runtime: options.runtime,
      defaultTask: options.defaultTask,
      serverPrewarm: options.serverPrewarm,
      serverWorker: options.serverWorker,
      serverWorkerEntry,
      browserWorker: options.browserWorker,
      browserPrewarm: options.browserPrewarm,
      models: options.models,
    }

    addImports({
      name: "useLocalModel",
      from: resolve("./runtime/composables/useLocalModel"),
    })

    addImports({
      name: "prewarmLocalModel",
      from: resolve("./runtime/composables/useLocalModel"),
    })

    addTypeTemplate({
      filename: "types/nuxt-local-model-configured.d.ts",
      getContents: () => renderLocalModelRegistry(options),
    })

    addPlugin({
      src: resolve("./runtime/plugins/hf-transformers.server"),
    })

    addPlugin({
      src: resolve("./runtime/plugins/hf-transformers.client"),
      mode: "client",
    })

    nuxt.hook("ready", async () => {
      const modelNames = resolvePrewarmTargets(options.serverPrewarm ?? false, options.models || {})
        .filter(name => name in (options.models || {}))
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

export default module
