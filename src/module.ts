import type {} from "./runtime/nuxt"
import { defineNuxtModule, addImports, addPlugin, addServerPlugin, addTypeTemplate, createResolver, resolvePath } from "@nuxt/kit"
import { existsSync } from "node:fs"
// `@nuxt/schema` must be a direct dependency: pnpm's isolated node_modules does
// not expose transitive packages to the root project.
import type { NuxtModule } from "@nuxt/schema"
import type { LocalModelRuntimeConfig } from "./runtime/types"
import type { InternalLocalModelRuntimeConfig } from "./runtime/utils"
import { setLocalModelRuntimeConfig } from "./runtime/shared/local-model"

type LocalModelPublicRuntimeConfig = LocalModelRuntimeConfig & {
  serverWorkerEntry?: string
}

export type NuxtLlmModuleOptions = LocalModelRuntimeConfig

function resolvePrewarmTargets(prewarm: boolean | string[], models: Record<string, unknown>) {
  if (prewarm === true) return Object.keys(models)
  if (Array.isArray(prewarm)) return prewarm
  return []
}

/**
 * `runtimeConfig.public` is serialized to every client, so it must not carry
 * server-only detail. Adapter path specifiers are resolved to absolute
 * build-machine paths, and `sessionOptions` can hold credentials for a private
 * model host. Bundled preset names (e.g. `"shared-prefix"`) carry no such
 * detail and are published as-is, so the browser resolves the same adapter.
 * A custom path adapter still falls back to the bundled ONNX adapter in the
 * browser; those must come in via the composable's own `adapter` option.
 */
function toPublicDecisionModels(
  decisionModels: LocalModelRuntimeConfig["decisionModels"],
): LocalModelRuntimeConfig["decisionModels"] {
  if (!decisionModels) return decisionModels

  return Object.fromEntries(
    Object.entries(decisionModels).map(([alias, definition]) => {
      const { adapter, sessionOptions: _sessionOptions, ...rest } = definition
      // Bundled preset names are safe to publish. Anything else is either a
      // user path (resolved to an absolute build-machine path above, which
      // must never reach clients) or an unknown specifier the browser cannot
      // load — both are stripped so the browser falls back to bundled ONNX.
      const preset = adapter?.toLowerCase() === "shared-prefix"
        ? { adapter }
        : {}
      return [alias, { ...rest, ...preset }]
    }),
  )
}


function renderLocalModelRegistry(options: LocalModelRuntimeConfig) {
  const defaultTask = options.defaultTask || "feature-extraction"
  const entries = Object.entries(options.models || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alias, definition]) => {
      const task = definition?.task || defaultTask
      return `    ${JSON.stringify(alias)}: ${JSON.stringify(task)}`
    })

  const body = entries.length > 0 ? `\n${entries.join("\n")}\n` : "\n"

  return `declare global {
  interface NuxtLocalModelRegistry {${body}  }
}

export {}
`
}

const ALIAS_PREFIXES = ["~/", "@/", "/"] as const

async function resolveDecisionModelAdapters(
  decisionModels: LocalModelRuntimeConfig["decisionModels"],
  resolveAlias: (path: string) => string | Promise<string>,
): Promise<LocalModelRuntimeConfig["decisionModels"]> {
  if (!decisionModels) return decisionModels

  // Nitro server routes do not inherit Nuxt's `~`/`@` aliases, so adapter
  // specifiers are resolved to absolute paths here, at build time.
  const entries = await Promise.all(
    Object.entries(decisionModels).map(async ([alias, definition]) => {
      const specifier = definition.adapter
      const needsResolving = specifier && ALIAS_PREFIXES.some(prefix => specifier.startsWith(prefix))
      return [
        alias,
        needsResolving ? { ...definition, adapter: await resolveAlias(specifier) } : definition,
      ] as const
    }),
  )
  return Object.fromEntries(entries)
}



const module: NuxtModule<NuxtLlmModuleOptions, NuxtLlmModuleOptions, false> = defineNuxtModule<NuxtLlmModuleOptions>({
  meta: {
    name: "nuxt-local-model",
    configKey: "localModel",
  },
  defaults: {
    runtime: "auto",
    cacheDir: "./.ai-models",
    allowRemoteModels: true,
    allowLocalModels: true,
    defaultTask: "feature-extraction",
    serverPrewarm: false,
    serverWorker: false,
    browserWorker: false,
    browserPrewarm: false,
    models: {},
    decisionModels: {},
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    // Published, `import.meta.url` points into `dist/`; running from source in
    // the playground it points into `src/`. Check both so the worker works in
    // either case.
    const workerCandidates = [
      resolve("./runtime/server/worker.js"),
      resolve("../dist/runtime/server/worker.js"),
    ]
    // A worker thread cannot execute TypeScript source, so there is no `.ts`
    // fallback: without a build the worker is simply unavailable.
    const serverWorkerEntry = workerCandidates.find(path => existsSync(path))
    const decisionModels = await resolveDecisionModelAdapters(
      options.decisionModels,
      path => resolvePath(path, { alias: nuxt.options.alias }),
    )

    if (options.browserWorker) {
      nuxt.options.vite ||= {}
      nuxt.options.vite.worker ||= {}
      nuxt.options.vite.worker.format ||= "es"
    }

    setLocalModelRuntimeConfig({
      ...options,
      decisionModels,
      serverWorkerEntry,
    })

    // Private copy: Nitro plugins and server routes need the unredacted
    // definitions, which never reach clients. Assigned through the module's
    // own contract: the generated schema narrows `localModel` to the exact
    // playground snapshot, but setup must accept any user config.
    const privateRuntimeConfig = nuxt.options.runtimeConfig as unknown as {
      localModel?: InternalLocalModelRuntimeConfig
    }
    privateRuntimeConfig.localModel = {
      ...options,
      decisionModels: decisionModels ?? {},
      serverWorkerEntry: serverWorkerEntry ?? "",
    }

    const publicRuntimeConfig = nuxt.options.runtimeConfig.public as Record<string, unknown> & {
      localModel?: LocalModelPublicRuntimeConfig
    }
    publicRuntimeConfig.localModel = {

      cacheDir: options.cacheDir,
      allowRemoteModels: options.allowRemoteModels,
      allowLocalModels: options.allowLocalModels,
      runtime: options.runtime,
      defaultTask: options.defaultTask,
      serverPrewarm: options.serverPrewarm,
      serverWorker: options.serverWorker,
      browserWorker: options.browserWorker,
      browserPrewarm: options.browserPrewarm,
      models: options.models,
      decisionModels: toPublicDecisionModels(decisionModels),
    }

    // Nitro routes get their own server-side config store; the public copy is
    // redacted, so it cannot be the source.
    addServerPlugin(resolve("./runtime/server/config-plugin"))

    addImports({
      name: "useLocalModel",
      from: resolve("./runtime/composables/useLocalModel"),
    })

    addImports({
      name: "prewarmLocalModel",
      from: resolve("./runtime/composables/useLocalModel"),
    })

    addImports({
      name: "useDecisionModel",
      from: resolve("./runtime/composables/useDecisionModel"),
    })

    addTypeTemplate({
      filename: "types/nuxt-local-model-configured.d.ts",
      getContents: () => renderLocalModelRegistry(options),
    })

    addPlugin({
      src: resolve("./runtime/plugins/hf-transformers.server"),
    })

    addPlugin({
      src: resolve("./runtime/plugins/hf-transformers.client"),
      mode: "client",
    })

    nuxt.hook("ready", async () => {
      const modelNames = resolvePrewarmTargets(options.serverPrewarm ?? false, options.models || {})
        .filter(name => name in (options.models || {}))
      if (modelNames.length === 0) return
      const { loadLocalModel } = await import("./runtime/shared/local-model")
      const results = await Promise.allSettled(modelNames.map((name) => loadLocalModel(name, options)))
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const name = modelNames[index]
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
          console.warn(`[nuxt-local-model] failed to warm model "${name}" during startup: ${reason}`)
        }
      })
    })
  },
})

export default module
