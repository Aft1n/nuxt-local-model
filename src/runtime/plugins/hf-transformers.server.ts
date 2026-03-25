import { defineNuxtPlugin, useRuntimeConfig } from "nuxt/app"
import { readdir, stat } from "node:fs/promises"
import { setLocalModelRuntimeConfig } from "../shared/local-model"
import { applyLocalModelEnvironment, type InternalLocalModelRuntimeConfig, resolveRuntimeConfig } from "../utils"

async function countCachedEntries(cacheDir: string) {
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() || entry.isFile()).length
  } catch {
    return 0
  }
}

export default defineNuxtPlugin(async () => {
  const runtimeConfig = useRuntimeConfig()
  const publicRuntimeConfig = runtimeConfig.public as { localModel?: InternalLocalModelRuntimeConfig }
  const localModel = resolveRuntimeConfig(publicRuntimeConfig.localModel)

  await applyLocalModelEnvironment(localModel)
  setLocalModelRuntimeConfig(localModel)

  const modelNames = Object.keys(localModel.models || {})
  const cacheStatBefore = await stat(localModel.cacheDir).catch(() => null)
  const cachedEntriesBefore = cacheStatBefore?.isDirectory() ? await countCachedEntries(localModel.cacheDir) : 0
  const cacheStatus =
    cachedEntriesBefore > 0
      ? `✅ found ${cachedEntriesBefore} cached model entr${cachedEntriesBefore === 1 ? "y" : "ies"} at ${localModel.cacheDir}`
      : `⬇️ no cached models found yet at ${localModel.cacheDir}; missing models may download now`

  const cacheStat = await stat(localModel.cacheDir).catch(() => null)
  const cachedEntries = cacheStat?.isDirectory() ? await countCachedEntries(localModel.cacheDir) : 0

  console.info(
    `🤖 [nuxt-local-model] ${cacheStatus} • 🚀 ${modelNames.length} configured model(s) will load when Nuxt finishes starting • 📦 cache now has ${cachedEntries} entr${cachedEntries === 1 ? "y" : "ies"}`,
  )
})
