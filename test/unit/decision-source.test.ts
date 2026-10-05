import { describe, expect, it } from "vitest"
import { isHfId, isHttpUrl, resolveDecisionSource, resolveModelFile } from "../../src/runtime/shared/decision-source"

describe("decision source resolution", () => {
  it("passes local paths through untouched", () => {
    expect(resolveDecisionSource("./models/triage")).toBe("./models/triage")
    expect(resolveDecisionSource("/data/models/triage")).toBe("/data/models/triage")
    expect(resolveDecisionSource("./model.onnx")).toBe("./model.onnx")
  })

  it("passes full URLs through untouched", () => {
    const url = "https://huggingface.co/my-org/my-decision-model/resolve/main/onnx/model.onnx"
    expect(resolveDecisionSource(url)).toBe(url)
    expect(isHttpUrl(url)).toBe(true)
    expect(isHttpUrl("./models/triage")).toBe(false)
  })

  it("resolves a Hugging Face id to a resolve URL", () => {
    expect(resolveDecisionSource("my-org/my-decision-model"))
      .toBe("https://huggingface.co/my-org/my-decision-model/resolve/main/")
    expect(isHfId("my-org/my-decision-model")).toBe(true)
    expect(isHfId("./models/triage")).toBe(false)
    expect(isHfId("https://example.com/model.onnx")).toBe(false)
  })

  it("honours inline and explicit revisions", () => {
    expect(resolveDecisionSource("my-org/my-decision-model@cf92c2f"))
      .toBe("https://huggingface.co/my-org/my-decision-model/resolve/cf92c2f/")
    expect(resolveDecisionSource("my-org/my-decision-model", { revision: "v1" }))
      .toBe("https://huggingface.co/my-org/my-decision-model/resolve/v1/")
  })

  it("resolves to a cache dir when configured", () => {
    expect(resolveDecisionSource("my-org/my-decision-model", { cacheDir: "./.ai-models" }))
      .toBe("./.ai-models/my-org/my-decision-model/main")
  })

  it("joins directory bases with the manifest model file", () => {
    expect(resolveModelFile("https://example.com/models/triage/", "model.onnx"))
      .toBe("https://example.com/models/triage/model.onnx")
    expect(resolveModelFile("./models/triage")).toBe("./models/triage/model.onnx")
    expect(resolveModelFile("https://example.com/x/model.onnx")).toBe("https://example.com/x/model.onnx")
  })
})
