import { beforeEach, describe, expect, it, vi } from "vitest"
import module from "../../src/module"
import type { LocalModelRuntimeConfig } from "../../src/runtime/types"

const {
  addTypeTemplate,
  addImports,
  addPlugin,
  createResolver,
  setLocalModelRuntimeConfig,
  loadLocalModel,
  existsSync,
} = vi.hoisted(() => ({
  addTypeTemplate: vi.fn(),
  addImports: vi.fn(),
  addPlugin: vi.fn(),
  createResolver: vi.fn(() => ({
    resolve: (path: string) => `/resolved${path}`,
  })),
  setLocalModelRuntimeConfig: vi.fn(),
  loadLocalModel: vi.fn(),
  existsSync: vi.fn((path: string) => path.endsWith("worker.js")),
}))

vi.mock("@nuxt/kit", () => ({
  defineNuxtModule: <T>(config: T) => config,
  addTypeTemplate,
  addImports,
  addPlugin,
  createResolver,
}))

vi.mock("node:fs", () => ({
  existsSync,
}))

vi.mock("../../src/runtime/shared/local-model", () => ({
  setLocalModelRuntimeConfig,
  loadLocalModel,
}))

type TestedModule = {
  meta: {
    configKey: string
  }
  setup: (
    options: LocalModelRuntimeConfig,
    nuxt: {
      options: {
        runtimeConfig: {
          public: Record<string, unknown>
        }
        vite?: {
          worker?: {
            format?: string
          }
        }
      }
      hook: (name: string, callback: () => Promise<void>) => void
    },
  ) => void
}

const testedModule = module as unknown as TestedModule

describe("module metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exposes the expected config key", () => {
    expect(testedModule.meta.configKey).toBe("localModel")
  })

  it("registers imports, plugins, runtime config, and startup warmup", async () => {
    let readyHook: (() => Promise<void>) | undefined
    type SetupNuxt = Parameters<typeof testedModule.setup>[1]
    const nuxt: SetupNuxt = {
      options: {
        runtimeConfig: {
          public: {},
        },
      },
      hook: vi.fn((name: string, callback: () => Promise<void>) => {
        if (name === "ready") {
          readyHook = callback
        }
      }),
    }

    const options = {
      runtime: "deno" as const,
      cacheDir: "./cache",
      allowRemoteModels: true,
      allowLocalModels: true,
      defaultTask: "feature-extraction" as const,
      serverWorker: true,
      browserWorker: true,
      browserPrewarm: ["embedding"],
      models: {
        embedding: {
          task: "feature-extraction" as const,
          model: "Xenova/all-MiniLM-L6-v2",
        },
      },
    }

    testedModule.setup(options, nuxt)

    expect(setLocalModelRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "deno",
        serverWorkerEntry: "/resolved./runtime/server/worker.js",
      }),
    )

    expect(addImports).toHaveBeenCalledWith({
      name: "useLocalModel",
      from: "/resolved./runtime/composables/useLocalModel",
    })
    expect(addImports).toHaveBeenCalledWith({
      name: "prewarmLocalModel",
      from: "/resolved./runtime/composables/useLocalModel",
    })
    expect(addTypeTemplate).toHaveBeenCalledWith(expect.objectContaining({
      filename: "types/nuxt-local-model-configured.d.ts",
    }))
    expect(addPlugin).toHaveBeenNthCalledWith(1, {
      src: "/resolved./runtime/plugins/hf-transformers.server",
    })
    expect(addPlugin).toHaveBeenNthCalledWith(2, {
      src: "/resolved./runtime/plugins/hf-transformers.client",
      mode: "client",
    })

    expect((nuxt.options.runtimeConfig.public as { localModel?: unknown }).localModel).toMatchObject({
      runtime: "deno",
      cacheDir: "./cache",
      serverWorker: true,
      browserPrewarm: ["embedding"],
      models: options.models,
      serverWorkerEntry: "/resolved./runtime/server/worker.js",
    })
    expect(nuxt.options.vite?.worker?.format).toBe("es")
    expect(addTypeTemplate.mock.calls[0]?.[0]?.getContents()).toContain("\"embedding\": \"feature-extraction\"")

    expect(readyHook).toBeTypeOf("function")
    await readyHook?.()
    expect(loadLocalModel).toHaveBeenCalledWith("embedding", options)
  })
})
