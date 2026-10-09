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
    decisionModels: {
      triage: {
        source: "./models/triage",
        adapter: "~/decision-adapter",
      },
      // Bekko System One 17M: manifest-directory browser export, fetched from
      // the Hub on first use. `subdir` picks the export dir (default is onnx/).
      bekko: {
        source: "hotchpotch/bekko-system-one-v0-17m",
        subdir: "onnx_browser",
        adapter: "shared-prefix",
        revision: "b886a1f9b91f4e8368d7830080d52d955e2c8dfa",
      },
    },
  },
})
