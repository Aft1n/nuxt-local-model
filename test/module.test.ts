import { describe, expect, it, vi } from "vitest"
import module from "../src/module"

vi.mock("@nuxt/kit", () => ({
  defineNuxtModule: () => ({
    with: (config: any) => config,
  }),
  addImports: vi.fn(),
  addPlugin: vi.fn(),
  createResolver: () => ({ resolve: (path: string) => path }),
}))

describe("module metadata", () => {
  it("exposes the expected config key", () => {
    expect(module.meta.configKey).toBe("localModel")
  })
})
