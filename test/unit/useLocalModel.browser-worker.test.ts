import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prewarmLocalModel, useLocalModel } from "../../src/runtime/composables/useLocalModel"

const { runtimeConfig } = vi.hoisted(() => ({
  runtimeConfig: {
    public: {
      localModel: {
        browserWorker: true,
        models: {
          embedding: {
            task: "feature-extraction",
            model: "Xenova/all-MiniLM-L6-v2",
          },
        },
      },
    },
  },
}))

vi.mock("nuxt/app", () => ({
  useRuntimeConfig: () => runtimeConfig,
}))

class FakeWorker {
  static instances: FakeWorker[] = []

  url: URL
  options: { type: string }
  terminated = false
  messages: unknown[] = []
  listeners = {
    message: new Set<(event: MessageEvent<unknown>) => void>(),
    messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
  }

  onerror: ((error: unknown) => void) | null = null

  constructor(url: URL, options: { type: string }) {
    this.url = url
    this.options = options
    FakeWorker.instances.push(this)
  }

  addEventListener(type: "message", listener: (event: MessageEvent<{ id?: string; type?: string; requestId?: string; ok?: boolean; result?: unknown }>) => void): void
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(
    type: "message" | "messageerror",
    listener:
      | ((event: MessageEvent<{ id?: string; type?: string; requestId?: string; ok?: boolean; result?: unknown }>) => void)
      | ((event: MessageEvent<unknown>) => void),
  ) {
    this.listeners[type].add(listener as (event: MessageEvent<unknown>) => void)
  }

  removeEventListener(type: "message", listener: (event: MessageEvent<{ id?: string; type?: string; requestId?: string; ok?: boolean; result?: unknown }>) => void): void
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(
    type: "message" | "messageerror",
    listener:
      | ((event: MessageEvent<{ id?: string; type?: string; requestId?: string; ok?: boolean; result?: unknown }>) => void)
      | ((event: MessageEvent<unknown>) => void),
  ) {
    this.listeners[type].delete(listener as (event: MessageEvent<unknown>) => void)
  }

  postMessage(message: { type: string; id?: string; requestId?: string; args?: unknown[] }) {
    this.messages.push(message)

    queueMicrotask(() => {
      if (message.type === "init" && message.id) {
        this.emit("message", {
          data: {
            id: message.id,
            ok: true,
            type: "init",
          },
        } as MessageEvent<{ id: string; ok: boolean; type: "init" }>)
        return
      }

      if (message.type === "run" && message.id && message.requestId) {
        this.emit("message", {
          data: {
            id: message.id,
            requestId: message.requestId,
            ok: true,
            type: "run",
            result: message.args,
          },
        } as MessageEvent<{ id: string; requestId: string; ok: boolean; type: "run"; result: unknown }>)
        return
      }

      if (message.type === "dispose" && message.id) {
        this.emit("message", {
          data: {
            id: message.id,
            ok: true,
            type: "dispose",
          },
        } as MessageEvent<{ id: string; ok: boolean; type: "dispose" }>)
      }
    })
  }

  emit(type: "message" | "messageerror", event: MessageEvent<unknown>) {
    for (const listener of this.listeners[type]) {
      listener(event as never)
    }
  }

  terminate() {
    this.terminated = true
    return Promise.resolve(0)
  }
}

vi.stubGlobal("Worker", FakeWorker)

const defineProcessFlag = (key: "client" | "server", value: boolean) => {
  Object.defineProperty(process, key, {
    configurable: true,
    value,
  })
}

defineProcessFlag("client", true)
defineProcessFlag("server", false)

describe("browser worker local model", () => {
  beforeEach(() => {
    FakeWorker.instances = []
    runtimeConfig.public.localModel.browserWorker = true
    defineProcessFlag("client", true)
    defineProcessFlag("server", false)
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (process as { client?: boolean; server?: boolean }).client
    delete (process as { client?: boolean; server?: boolean }).server
  })

  it("keeps per-call options when a model is prewarmed first", async () => {
    await prewarmLocalModel("embedding")

    const model = await useLocalModel("embedding", {
      normalize: true,
      pooling: "mean",
    })

    const result = await model("hello world")

    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].messages.filter((message) => (message as { type: string }).type === "init")).toHaveLength(1)
    expect(FakeWorker.instances[0].messages.filter((message) => (message as { type: string }).type === "run")).toHaveLength(1)
    expect(result).toEqual(["hello world", { normalize: true, pooling: "mean" }])
  })
})
