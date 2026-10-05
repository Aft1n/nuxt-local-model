import type { DecisionModelAdapter } from "../types"

/**
 * One cache shared by the composable (`useDecisionModel`) and the server loader
 * (`getDecisionModel`) so a session opened in the app is reused — and
 * released — by the server side instead of loading a second ONNX session for
 * the same model.
 */
const sessionCache = new Map<string, Promise<DecisionModelAdapter>>()
/** Live holder count per session promise, so shared adapters dispose on last release. */
const sessionRefs = new Map<Promise<DecisionModelAdapter>, number>()

/**
 * Override adapters are keyed by factory identity so two callers passing
 * different factories for the same name + source do not share a session.
 */
const factoryIds = new WeakMap<object, number>()
let nextFactoryId = 1

function factoryIdentity(factory: object): number {
  let id = factoryIds.get(factory)
  if (id === undefined) {
    id = nextFactoryId++
    factoryIds.set(factory, id)
  }
  return id
}

/**
 * Stable stringify: keys sorted, functions by identity, `undefined` dropped —
 * so two definitions differing only in key order still share a session.
 */
function stableStringify(value: unknown): string | undefined {
  if (typeof value === "function") return `#f${factoryIdentity(value)}`
  if (value === undefined) return undefined
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item) ?? "null").join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, item]) => `${JSON.stringify(k)}:${stableStringify(item)}`).join(",")}}`
}

/**
 * Cache key for a resolved definition. The whole definition is fingerprinted,
 * not just name + source, so definitions differing in tokenizer / maxTokens /
 * outputMap / sessionOptions never share a session. The caller's factory
 * identity is part of the key so an override runtime never reuses the
 * configured adapter.
 */
export function decisionSessionKey(
  name: string,
  definition: { source?: string, adapter?: string },
  override?: object,
): string {
  const fingerprint = stableStringify(definition) ?? "{}"
  return override
    ? `override:${name}::${fingerprint}::${factoryIdentity(override)}`
    : `${name}::${fingerprint}`
}

/**
 * Returns the cached session for `key`, creating it via `factory` on a miss.
 * A rejected load is evicted so the next call retries instead of replaying the
 * same rejected promise.
 */
export function getDecisionSession(
  key: string,
  factory: () => Promise<DecisionModelAdapter>,
): Promise<DecisionModelAdapter> {
  const cached = sessionCache.get(key)
  if (cached) {
    sessionRefs.set(cached, (sessionRefs.get(cached) ?? 0) + 1)
    return cached
  }
  return cacheDecisionSession(key, factory())
}

/**
 * Same as `getDecisionSession`, but replaces the entry with a fresh load. The
 * superseded session is detached, not disposed: other holders keep using it
 * and it disposes on its last release.
 */
export function reloadDecisionSession(
  key: string,
  factory: () => Promise<DecisionModelAdapter>,
): Promise<DecisionModelAdapter> {
  return cacheDecisionSession(key, factory())
}

function cacheDecisionSession(
  key: string,
  pending: Promise<DecisionModelAdapter>,
): Promise<DecisionModelAdapter> {
  sessionCache.set(key, pending)
  sessionRefs.set(pending, 1)
  // Evict a rejected load so the next call retries rather than replaying the
  // same rejected promise forever.
  pending.catch(() => {
    if (sessionCache.get(key) === pending) {
      sessionCache.delete(key)
    }
    sessionRefs.delete(pending)
  })
  return pending
}

/**
 * Releases one holder of `handle`. Returns true only for the last holder, in
 * which case the caller disposes the adapter. A stale handle (superseded by a
 * reload, or cleared by reset) decrements its own session without touching the
 * current cache entry.
 */
export function releaseDecisionSession(key: string, handle: Promise<DecisionModelAdapter>): boolean {
  const holders = sessionRefs.get(handle)
  if (holders === undefined) {
    return false
  }
  if (holders > 1) {
    sessionRefs.set(handle, holders - 1)
    return false
  }
  sessionRefs.delete(handle)
  if (sessionCache.get(key) === handle) {
    sessionCache.delete(key)
  }
  return true
}

/**
 * Clears the cache and disposes every live adapter it evicted. Individual
 * dispose failures are swallowed so one bad session cannot break the reset.
 */
export async function resetDecisionSessions(): Promise<void> {
  const pending = [...sessionCache.values()]
  sessionCache.clear()
  sessionRefs.clear()
  await Promise.all(
    pending.map((entry) =>
      entry.then(
        (adapter) => Promise.resolve(adapter.dispose?.()).catch(() => {}),
        () => {},
      ),
    ),
  )
}