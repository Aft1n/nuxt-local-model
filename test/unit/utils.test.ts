import { afterEach, describe, expect, it, vi } from "vitest"
import {
  detectLocalModelRuntime,
  resolveCacheDir,
  resolveModelDefinition,
  resolveRuntimeConfig,
} from "../../src/runtime/utils"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("local model utils", () => {
  it("resolves cache dir from config first", () => {
    expect(resolveCacheDir("/tmp/models")).toBe("/tmp/models")
  })

  it("falls back to env and then default", () => {
    vi.stubEnv("NUXT_LOCAL_MODEL_CACHE_DIR", "/env-model-cache")
    expect(resolveCacheDir()).toBe("/env-model-cache")
    vi.unstubAllEnvs()
    expect(resolveRuntimeConfig({}).cacheDir).toBe("./.ai-models")
  })

  it("detects bun and deno runtimes when auto mode is used", () => {
    vi.stubGlobal("Bun", {})
    expect(detectLocalModelRuntime()).toBe("bun")

    vi.unstubAllGlobals()
    vi.stubGlobal("Deno", { version: { deno: "2.0.0" } })
    expect(detectLocalModelRuntime()).toBe("deno")
  })

  it("defaults worker modes to off and local models to on", () => {
    const resolved = resolveRuntimeConfig({})
    expect(resolved.serverWorker).toBe(false)
    expect(resolved.browserWorker).toBe(false)
    expect(resolved.allowLocalModels).toBe(true)
    expect(resolved.runtime).toBe("node")
  })

  it("merges registry load options with per-call load options", () => {
    const definition = resolveModelDefinition("embedding", {
      defaultTask: "feature-extraction",
      models: {
        embedding: {
          task: "feature-extraction",
          model: "Xenova/all-MiniLM-L6-v2",
          options: { dtype: "q8" },
        },
      },
    }, {
      device: "cpu",
    })

    expect(definition.model).toBe("Xenova/all-MiniLM-L6-v2")
    expect(definition.task).toBe("feature-extraction")
    expect(definition.options).toEqual({ dtype: "q8", device: "cpu" })
  })

  it("throws when the model name is not registered", () => {
    expect(() => resolveModelDefinition("custom", { models: {} }, {})).toThrow(
      'Local model "custom" is not defined in nuxt.config.',
    )
  })
})
