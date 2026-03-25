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

  it("detects the active runtime in auto mode", () => {
    const denoGlobal = globalThis as typeof globalThis & {
      Deno?: {
        version?: {
          deno?: string
        }
      }
    }
    const expectedRuntime = typeof Bun !== "undefined"
      ? "bun"
      : typeof denoGlobal.Deno?.version?.deno === "string"
        ? "deno"
        : "node"

    expect(detectLocalModelRuntime()).toBe(expectedRuntime)
  })

  it("respects explicit runtime overrides", () => {
    expect(detectLocalModelRuntime("bun")).toBe("bun")
    expect(detectLocalModelRuntime("deno")).toBe("deno")
    expect(detectLocalModelRuntime("node")).toBe("node")
  })

  it("defaults worker modes to off and local models to on", () => {
    const resolved = resolveRuntimeConfig({})
    expect(resolved.serverWorker).toBe(false)
    expect(resolved.browserWorker).toBe(false)
    expect(resolved.allowLocalModels).toBe(true)
    expect(resolved.runtime).toBe(detectLocalModelRuntime())
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
