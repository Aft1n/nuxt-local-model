/**
 * Pure-string resolution of a decision-model `source` into something ONNX
 * Runtime (or a downloader) can open. No network and no filesystem access
 * here, so every rule below is unit-testable without either.
 */

/** A `http(s)://` URL. */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

/** `owner/repo` or `owner/repo@revision`, without a scheme or protocol. */
const HF_ID_RE = /^[\w.-]+\/[\w.-]+(?:@[\w.-]+(?:\/[\w.-]+)*)?$/

/**
 * A bare Hugging Face id such as `my-org/my-decision-model`, with an
 * optional `@revision` suffix. Local paths and URLs are rejected: a `/` inside a
 * path is not enough, the id must be exactly one or two path segments and must
 * not carry a scheme.
 */
export function isHfId(source: string): boolean {
  if (isHttpUrl(source) || source.includes("://")) return false
  // Local paths stay local: `./`, `../`, `/`, `~/` and `\` never name Hub repos.
  if (/^[./\\~]/.test(source) || source.includes("\\")) return false
  return HF_ID_RE.test(source)
}

export interface ResolveDecisionSourceOptions {
  /** Hugging Face revision/branch/tag/commit; defaults to `main`. */
  revision?: string
  /**
   * When set, a Hugging Face id resolves to a local mirror directory under this
   * path instead of a network URL, for hosts that pre-download the weights.
   */
  cacheDir?: string
}

/**
 * Turn a Hugging Face id into a base URL (or, with `cacheDir`, a local
 * directory). Anything else — a local path, a full URL — is returned as-is so
 * existing configurations keep working untouched.
 */
export function resolveDecisionSource(
  source: string,
  options: ResolveDecisionSourceOptions = {},
): string {
  if (!isHfId(source)) {
    return source
  }
  const [id, inlineRevision] = source.split("@") as [string, string | undefined]
  const revision = inlineRevision ?? options.revision ?? "main"
  if (options.cacheDir) {
    return `${options.cacheDir.replace(/\/+$/, "")}/${id}/${revision}`
  }
  return `https://huggingface.co/${id}/resolve/${revision}/`
}

/**
 * Join a base (directory URL or local dir) with a model filename. A base that
 * already points at a concrete file is returned untouched, so callers can pass
 * either shape. `manifestModelFile` comes from a `manifest.json`; without one
 * the shared-prefix manifest layout default `model.onnx` is assumed.
 */
export function resolveModelFile(base: string, manifestModelFile?: string): string {
  if (/\.onnx$/i.test(base) || /\.onnx([?#].*)?$/i.test(base)) {
    return base
  }
  const file = manifestModelFile ?? "model.onnx"
  return `${base.replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`
}
