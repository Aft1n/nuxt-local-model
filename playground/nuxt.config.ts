/// <reference path="../dist/runtime/nuxt.d.ts" />
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    // One cache folder covers both downloads and local reuse.
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
