import { describe, expect, it } from "vitest"
import { serializeWorkerResult } from "../../src/runtime/shared/serialize"

describe("serializeWorkerResult", () => {
  it("converts typed arrays into plain arrays", () => {
    expect(serializeWorkerResult(new Float32Array([1, 2, 3]))).toEqual([1, 2, 3])
  })

  it("serializes tensor-like objects with nested data", () => {
    const result = serializeWorkerResult({
      data: new Float32Array([0.1, 0.2]),
      shape: [1, 2],
      dims: [1, 2],
      type: "float32",
    }) as { data: number[]; shape: number[]; dims: number[]; type: string }

    expect(result.shape).toEqual([1, 2])
    expect(result.dims).toEqual([1, 2])
    expect(result.type).toBe("float32")
    expect(result.data[0]).toBeCloseTo(0.1, 5)
    expect(result.data[1]).toBeCloseTo(0.2, 5)
  })

  it("uses tolist when present so worker results stay clone-safe", () => {
    const result = serializeWorkerResult({
      tolist: () => [[1, 2, 3]],
    })

    expect(result).toEqual([[1, 2, 3]])
  })
})
