import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import plugin from "../../src/runtime/plugins/hf-transformers.client"
import type { LocalModelRuntimeConfig } from "../../src/runtime/types"

const { applyLocalModelEnvironment, prewarmLocalModel, runtimeConfig } = vi.hoisted(() => {
  const runtimeConfig = {
    public: {
      localModel: {
        browserWorker: true,
        browserPrewarm: ["embedding"],
        models: {
          embedding: {
            task: "feature-extraction",
            model: "Xenova/all-MiniLM-L6-v2",
          },
          summary: {
            task: "text-generation",
            model: "Xenova/TinyLlama-1.1B-Chat-v1.0",
          },
        },
      } as LocalModelRuntimeConfig,
    },
  }

  return {
    applyLocalModelEnvironment: vi.fn().mockResolvedValue(undefined),
    prewarmLocalModel: vi.fn().mockResolvedValue(undefined),
    runtimeConfig,
  }
})

vi.mock("nuxt/app", () => ({
  defineNuxtPlugin: (factory: unknown) => factory,
  useRuntimeConfig: () => runtimeConfig,
}))

vi.mock("../../src/runtime/utils", async () => {
  const actual = await vi.importActual<typeof import("../../src/runtime/utils")>("../../src/runtime/utils")
  return {
    ...actual,
    applyLocalModelEnvironment,
  }
})

vi.mock("../../src/runtime/composables/useLocalModel", () => ({
  prewarmLocalModel,
}))

describe("browser prewarm client plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeConfig.public.localModel.browserPrewarm = ["embedding"]
    vi.stubGlobal("window", {
      requestIdleCallback: (callback: () => void) => {
        callback()
        return 1
      },
      setTimeout: (callback: () => void) => {
        callback()
        return 1
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("prewarms only configured aliases on mount", async () => {
    const mountedHooks: Array<() => void> = []
    const nuxtApp = {
      hook: vi.fn((name: string, callback: () => void) => {
        if (name === "app:mounted") mountedHooks.push(callback)
      }),
    }

    await plugin(nuxtApp as never)

    expect(applyLocalModelEnvironment).toHaveBeenCalledWith({
      cacheDir: "./.ai-models",
      allowRemoteModels: true,
      allowLocalModels: false,
    })
    expect(nuxtApp.hook).toHaveBeenCalledWith("app:mounted", expect.any(Function))

    mountedHooks[0]?.()
    await vi.dynamicImportSettled()
    await Promise.resolve()

    expect(prewarmLocalModel).toHaveBeenCalledTimes(1)
    expect(prewarmLocalModel).toHaveBeenCalledWith("embedding")
  })

  it("prewarms all registered aliases when enabled with true", async () => {
    runtimeConfig.public.localModel.browserPrewarm = true

    const mountedHooks: Array<() => void> = []
    const nuxtApp = {
      hook: vi.fn((name: string, callback: () => void) => {
        if (name === "app:mounted") mountedHooks.push(callback)
      }),
    }

    await plugin(nuxtApp as never)

    mountedHooks[0]?.()
    await vi.dynamicImportSettled()
    await Promise.resolve()

    expect(prewarmLocalModel).toHaveBeenCalledTimes(2)
    expect(prewarmLocalModel.mock.calls.map(([alias]) => alias).sort()).toEqual(["embedding", "summary"])
  })
})
