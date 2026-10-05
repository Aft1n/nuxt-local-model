import { setLocalModelRuntimeConfig } from "../shared/local-model"
import { resolveRuntimeConfig, type InternalLocalModelRuntimeConfig } from "../utils"

/**
 * Publishes the module's resolved config for Nitro server routes.
 *
 * The copy on `runtimeConfig.public` is redacted (adapter specifiers are
 * resolved to absolute build paths, which must not reach clients), so Nitro
 * cannot read the full definitions from it. This plugin fills the server-side
 * store from the private runtime config instead, which Nitro does keep.
 *
 * `defineNitroPlugin` and `useRuntimeConfig` are Nitro globals supplied by the
 * generated server bundle; importing them here would pin this file to a
 * particular nitropack version.
 */
export default defineNitroPlugin(() => {
  const runtimeConfig = useRuntimeConfig()
  const localModel = (runtimeConfig as { localModel?: InternalLocalModelRuntimeConfig }).localModel

  if (!localModel) return

  setLocalModelRuntimeConfig({
    ...resolveRuntimeConfig(localModel),
    serverWorkerEntry: localModel.serverWorkerEntry,
  })
})
