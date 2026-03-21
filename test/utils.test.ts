import { describe, expect, it } from "vitest"
import { resolveCacheDir, resolveModelDefinition, resolveRuntimeConfig } from "../src/runtime/utils"

describe("local model utils", () => {
  it("resolves cache dir from config first", () => {
    expect(resolveCacheDir("/tmp/models")).toBe("/tmp/models")
  })

  it("keeps windows-style cache paths intact", () => {
    expect(resolveCacheDir("C:\\models\\cache")).toBe("C:\\models\\cache")
  })

  it("falls back to env and then default", () => {
    expect(resolveRuntimeConfig({}).cacheDir).toBe("./.ai-models")
  })

  it("defaults worker modes to off", () => {
    expect(resolveRuntimeConfig({}).serverWorker).toBe(false)
    expect(resolveRuntimeConfig({}).browserWorker).toBe(false)
  })

  it("merges registry options with per-call pipeline options", () => {
    const definition = resolveModelDefinition(
      "embedding",
      {
        defaultTask: "feature-extraction",
        models: {
          embedding: {
            task: "feature-extraction",
            model: "Xenova/all-MiniLM-L6-v2",
            options: { dtype: "q8" },
          },
        },
      },
      { pooling: "mean" },
    )

    expect(definition.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(definition.task).toBe("feature-extraction")
    expect(definition.options).toEqual({ dtype: "q8", pooling: "mean" })
  })

  it("throws when the model name is not registered", () => {
    expect(() =>
      resolveModelDefinition("custom", { models: {} }, {}),
    ).toThrow('Local model "custom" is not defined in nuxt.config.')
  })
})
