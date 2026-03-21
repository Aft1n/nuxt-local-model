import type { LocalModelRuntimeConfig } from "./types"

declare module "@nuxt/schema" {
  interface NuxtConfig {
    localModel?: LocalModelRuntimeConfig
  }

  interface NuxtOptions {
    localModel?: LocalModelRuntimeConfig
  }

  interface RuntimeConfig {
    public: {
      localModel?: LocalModelRuntimeConfig
    }
  }
}

export {}
