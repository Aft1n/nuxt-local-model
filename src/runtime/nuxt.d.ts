import type { InternalLocalModelRuntimeConfig } from "./utils"
import type { LocalModelRuntimeConfig } from "./types"

declare module "@nuxt/schema" {
  interface NuxtConfig {
    localModel?: LocalModelRuntimeConfig
  }

  interface NuxtOptions {
    localModel?: LocalModelRuntimeConfig
  }

  interface RuntimeConfig {
    localModel?: InternalLocalModelRuntimeConfig
    public: {
      localModel?: LocalModelRuntimeConfig
    }
  }
}

export {}
