import { describe, expect, it } from "vitest"
import { env, pipeline } from "@huggingface/transformers"
import type { LocalModelPipeline, LocalModelRunner } from "../../src/runtime/types"


/** Calls either union member uniformly; type-checks that both stay invokable. */
const invokeEither = (run: LocalModelPipeline | LocalModelRunner, ...args: unknown[]) => run(...args)
describe("@huggingface/transformers v4 contract", () => {

  // v4 replaced the v3 `Pipeline` export with the `AllTasks` mapping, and dropped
  // nothing this module relies on. These guard the exact surface src/ touches.
  it("still exports pipeline()", () => {
    expect(typeof pipeline).toBe("function")
  })

  it("still exposes every env field the module mutates", () => {
    expect(env).toHaveProperty("cacheDir")
    expect(env).toHaveProperty("allowRemoteModels")
    expect(env).toHaveProperty("allowLocalModels")
    expect(env).toHaveProperty("localModelPath")
  })

  it("accepts the env assignments the plugins and composable perform", () => {
    const original = {
      cacheDir: env.cacheDir,
      localModelPath: env.localModelPath,
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
    }

    env.cacheDir = "./.ai-models"
    env.localModelPath = "/models-cache"
    env.allowRemoteModels = true
    env.allowLocalModels = true

    expect(env.cacheDir).toBe("./.ai-models")
    expect(env.localModelPath).toBe("/models-cache")
    expect(env.allowLocalModels).toBe(true)

    env.cacheDir = original.cacheDir
    env.localModelPath = original.localModelPath
    env.allowRemoteModels = original.allowRemoteModels
    env.allowLocalModels = original.allowLocalModels
  })

  it("keeps the module's uniform callable pipeline contract", async () => {
    // Both the resolved pipeline and the worker runners must stay invokable,
    // since useLocalModel() returns either one to the caller. This is a
    // compile-time contract: a non-invocable pipeline type fails to build here.
    const run = await invokeEither(async () => "ran")
    expect(run).toBe("ran")
  })
})