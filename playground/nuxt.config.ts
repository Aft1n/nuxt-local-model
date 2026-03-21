export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
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
        callOptions: {
          pooling: "mean",
          normalize: true,
        },
      },
    },
  },
})
