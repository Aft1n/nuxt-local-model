import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  addImports,
  addPlugin,
  createResolver,
  setLocalModelRuntimeConfig,
  loadLocalModel,
  existsSync,
} = vi.hoisted(() => ({
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
  defineNuxtModule: () => ({
    with: (config: any) => config,
  }),
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

import module from "../../src/module"

const testedModule = module as any

describe("module metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exposes the expected config key", () => {
    expect(testedModule.meta.configKey).toBe("localModel")
  })

  it("registers imports, plugins, runtime config, and startup warmup", async () => {
    let readyHook: (() => Promise<void>) | undefined
    const nuxt = {
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
      browserWorker: false,
      models: {
        embedding: {
          task: "feature-extraction" as const,
          model: "Xenova/all-MiniLM-L6-v2",
        },
      },
    }

    testedModule.setup(options, nuxt as any)

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
    expect(addPlugin).toHaveBeenNthCalledWith(1, {
      src: "/resolved./runtime/plugins/hf-transformers.server",
    })
    expect(addPlugin).toHaveBeenNthCalledWith(2, {
      src: "/resolved./runtime/plugins/hf-transformers.client",
      mode: "client",
    })

    expect((nuxt.options.runtimeConfig.public as any).localModel).toMatchObject({
      runtime: "deno",
      cacheDir: "./cache",
      serverWorker: true,
      models: options.models,
      serverWorkerEntry: "/resolved./runtime/server/worker.js",
    })

    expect(readyHook).toBeTypeOf("function")
    await readyHook?.()
    expect(loadLocalModel).toHaveBeenCalledWith("embedding", options)
  })
})
