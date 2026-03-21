export function serializeWorkerResult(value: unknown): unknown {
  if (value === null || value === undefined) return value

  if (Array.isArray(value)) {
    return value.map(serializeWorkerResult)
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>).map(Number)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value.entries()).map(([key, entry]) => [String(key), serializeWorkerResult(entry)]))
  }

  if (value instanceof Set) {
    return Array.from(value.values()).map(serializeWorkerResult)
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown> & {
      toJSON?: () => unknown
      tolist?: () => unknown
      data?: unknown
    }

    if (typeof candidate.tolist === "function") {
      return serializeWorkerResult(candidate.tolist())
    }

    if (typeof candidate.toJSON === "function") {
      const json = candidate.toJSON()
      if (json !== value) return serializeWorkerResult(json)
    }

    if (candidate.data !== undefined) {
      return {
        data: serializeWorkerResult(candidate.data),
        shape: serializeWorkerResult(candidate.shape),
        dims: serializeWorkerResult(candidate.dims),
        type: candidate.type,
      }
    }

    const plain: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(candidate)) {
      plain[key] = serializeWorkerResult(entry)
    }
    return plain
  }

  return value
}
