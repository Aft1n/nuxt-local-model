import type {} from "../src/runtime/nuxt"
import nuxtLocalModel from "../src/module"

export default defineNuxtConfig({
  modules: [nuxtLocalModel],
  localModel: {
    cacheDir: "./.ai-models",
    serverWorker: true,
    browserWorker: false,
    models: {
      embedding: {
        task: "feature-extraction",
        model: "Xenova/all-MiniLM-L6-v2",
        options: {
          dtype: "q8",
        },
      },
    },
  },
})
