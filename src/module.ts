import { defineNuxtModule, addImports, addPlugin, createResolver } from "@nuxt/kit"
import type { LocalModelRuntimeConfig } from "./runtime/types"

export interface NuxtLlmModuleOptions extends LocalModelRuntimeConfig {}

export default defineNuxtModule<NuxtLlmModuleOptions>().with({
  meta: {
    name: "nuxt-local-model",
    configKey: "localModel",
  },
  defaults: {
    cacheDir: "./.ai-models",
    allowRemoteModels: true,
    allowLocalModels: true,
    localModelPath: "/models/",
    defaultTask: "feature-extraction",
    serverWorker: false,
    browserWorker: false,
    models: {},
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    nuxt.options.runtimeConfig.public ||= {}
    ;(nuxt.options.runtimeConfig.public as { localModel?: NuxtLlmModuleOptions }).localModel = {
      cacheDir: options.cacheDir,
      allowRemoteModels: options.allowRemoteModels,
      allowLocalModels: options.allowLocalModels,
      localModelPath: options.localModelPath,
      defaultTask: options.defaultTask,
      serverWorker: options.serverWorker,
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
  },
})
