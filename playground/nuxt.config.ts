export default defineNuxtConfig({
  modules: ["../src/module"],
  localModel: {
    // The app cache path can be local/dev-only; the Docker container uses /models-cache.
    cacheDir: "./.ai-models",
    // In Docker, this path should match the mounted volume path.
    localModelPath: "/models-cache",
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
