# Nuxt Local Model

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

## Scalable local inference for Nuxt

<img src="https://raw.githubusercontent.com/Aft1n/nuxt-local-model/main/assets/module-banner.svg" alt="Nuxt Local Model banner" />

Note: This package is under active development. Please open issues if you run into anything unclear.

- [✨ &nbsp;Release Notes](/CHANGELOG.md)
- [📖 &nbsp;Documentation](https://github.com/Aft1n/nuxt-local-model)

A Nuxt module for easily integrating local Hugging Face transformer models into your Nuxt 4 application.

## Features

- Easily use local models in your Nuxt app
- Supports any Hugging Face task and model you want to configure
- Auto-imported composable, `useLocalModel()` by default for frontend Vue code
- Auto-imported `prewarmLocalModel()` helper for eager browser model loading
- Server-safe helper, `getLocalModel()` for `server/api` and utilities
- Explicit `serverPrewarm` and `browserPrewarm` controls instead of implicit startup warmup
- Fully configurable via `nuxt.config.ts`
- Supports changing model names, tasks, and settings per usage
- Optional worker-backed execution on the server or in the browser
- Server runtime support for Node, Bun, and Deno
- Works across macOS, Linux, Windows, and Docker
- Supports persistent model cache directories so models are not re-downloaded on every deploy

## Quick Setup

Install the module into your Nuxt application with one command:

```bash
npx nuxi module add nuxt-local-model
```

## Manual Installation

If you prefer to install manually, run:

```bash
# Using npm
npm install nuxt-local-model

# Using yarn
yarn add nuxt-local-model

# Using pnpm
pnpm add nuxt-local-model

# Using bun
bun add nuxt-local-model
```

Then, add it to your Nuxt config:

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
})
```

## Usage

Once installed, you can use `useLocalModel()` in your Vue app code.

For server routes and utilities, use `getLocalModel()`.

If you want a browser model to start loading before a user interacts with the UI, use
`prewarmLocalModel()` or enable `browserPrewarm` in `nuxt.config.ts`.

If you want models to warm on the server during Nuxt startup, enable `serverPrewarm`
explicitly. Server routes using `getLocalModel()` do not automatically imply startup warmup.

### Basic Example

```vue
<script setup lang="ts">
const embedder = await useLocalModel("embedding")
const output = await embedder("Nuxt local model example")
</script>
```

### Server Example

```ts
// server/api/demo/search.get.ts
import { getLocalModel } from "nuxt-local-model/server"

export default defineEventHandler(async () => {
  const embedder = await getLocalModel("embedding")
  return await embedder("hello world")
})
```

### Defining Models in `nuxt.config.ts`

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    runtime: "auto", // auto-detect Node, Bun, or Deno on the server
    cacheDir: "./.ai-models", // one cache folder for downloads and reuse
    allowRemoteModels: true, // allow fetching missing models from Hugging Face
    allowLocalModels: true, // allow reusing cached / mounted model files
    defaultTask: "feature-extraction", // default pipeline type when a model entry does not override it
    serverPrewarm: false, // false disables startup warmup, true warms all aliases on server startup, or pass ["embedding"] for specific aliases
    serverWorker: false, // run inference in a server worker thread on Node, Bun, or Deno
    browserWorker: false, // run inference in a browser Web Worker; avoid this for very large models
    browserPrewarm: false, // false disables browser prewarm, true warms all aliases after app mount, or pass ["embedding"] to warm specific aliases
    models: {
      embedding: {
        task: "feature-extraction", // the pipeline type for this alias
        model: "Xenova/all-MiniLM-L6-v2", // the Hugging Face model id
        options: {
          dtype: "q8", // model loading option passed through to Transformers.js
        },
      },
    },
  },
})
```

Tip: a plain `localModel: { ... }` object is enough for Nuxt config IntelliSense, and configured
model aliases now flow into `useLocalModel("...")` / `getLocalModel("...")` suggestions automatically.
If you want to reuse the config as a separate constant elsewhere, `as const satisfies LocalModelRuntimeConfig`
is the most Nuxt-native way to preserve literal alias keys without a helper.
If you are writing server routes, import `getLocalModel()` from `nuxt-local-model/server`.
In Vue app code, `useLocalModel()` is auto-imported once the module is installed.

### Overriding Settings at the Call Site

You can still provide the options for the model call where it is used:

```vue
<script setup lang="ts">
const model = await useLocalModel("embedding", {
  pooling: "mean",
  normalize: true,
})
</script>
```

### Prewarming a Model in the Browser

```vue
<script setup lang="ts">
onMounted(() => {
  void prewarmLocalModel("embedding", {
    pooling: "mean",
    normalize: true,
  })
})
</script>
```

### Automatic Browser Prewarm

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    browserWorker: true,
    browserPrewarm: ["embedding"],
    models: {
      embedding: {
        task: "feature-extraction",
        model: "Xenova/all-MiniLM-L6-v2",
      },
    },
  },
})
```

Set `browserPrewarm: true` to warm every configured alias on app mount, or pass a string array to warm only selected aliases.

### Explicit Server Prewarm

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    serverPrewarm: ["embedding"],
    models: {
      embedding: {
        task: "feature-extraction",
        model: "Xenova/all-MiniLM-L6-v2",
      },
    },
  },
})
```

Set `serverPrewarm: true` to warm every configured alias during Nuxt startup, or pass a string array to warm only selected aliases.

This is separate from browser prewarm:

- `serverPrewarm` runs during Nuxt startup on the server
- `browserPrewarm` runs after `app:mounted` in the browser
- calling `getLocalModel()` inside a server route stays on-demand and does not automatically prewarm at startup

## Configuration Options

You can configure the module in your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    runtime: "auto", // or "node", "bun", or "deno"
    cacheDir: "./.ai-models", // persistent cache folder for downloaded model assets
    allowRemoteModels: true, // download from Hugging Face if not yet cached
    allowLocalModels: true, // reuse local cache or mounted volume contents
    defaultTask: "feature-extraction", // default for aliases that do not override task
    serverPrewarm: false, // eager server-side prewarm: false, true, or a list of aliases
    serverWorker: true, // use a server worker thread so inference does not block the main server thread
    browserWorker: false, // enable only if you intentionally want browser-side inference
    browserPrewarm: false, // eager browser-side prewarm: false, true, or a list of aliases
    models: {
      embedding: {
        task: "feature-extraction", // embeddings usually use feature-extraction
        model: "Xenova/all-MiniLM-L6-v2", // any Hugging Face model id you choose
        options: {
          dtype: "q8", // loading/config option forwarded to Transformers.js
        },
      },
    },
  },
})
```

If `onnxruntime-node` is not available in your server runtime, the module now falls back to the default Transformers.js backend instead of crashing during startup.

## Warmup Behavior

The module now separates on-demand model usage from startup warmup:

- `useLocalModel()` loads a model in browser code when you call it
- `getLocalModel()` loads a model on the server when you call it
- `serverPrewarm` is the only thing that triggers eager server startup warmup
- `browserPrewarm` is the only thing that triggers eager browser warmup

This makes static sites and mixed environments much easier to reason about. For example:

- a static docs site can use `browserPrewarm: ["embedding"]` without warming models during server startup
- an API service can use `serverPrewarm: true` if it wants lower-latency first requests

### Cache Directory

The cache directory controls where downloaded model files are stored and reused.

Recommended defaults:

- local development: `./.ai-models`
- Docker: mount a persistent volume to the same path

Important:

- the cache path in `nuxt.config.ts` must match the path inside the Docker container
- the folder name on your laptop does not have to match the Docker folder name
- what matters in production is the path the app reads inside the container

Example Docker runtime setup:

```bash
docker run \
  -e NUXT_LOCAL_MODEL_CACHE_DIR=/data/local-models \
  -v local-models:/data/local-models \
  your-image:latest
```

This ensures the model files stay available across redeploys and container restarts.

What this does:

- `NUXT_LOCAL_MODEL_CACHE_DIR=/data/local-models` tells the app which folder to use for model caching
- `-v local-models:/data/local-models` mounts a persistent Docker volume at that same folder
  - the first container start downloads missing models into the mounted cache folder
  - later starts reuse the models already stored there

You can rename the host-facing volume however you want. What matters is that the path inside
the container matches the cache path used by the module.

In Docker, the environment variable and volume path point the app to the mounted folder:

```dockerfile
ENV NUXT_LOCAL_MODEL_CACHE_DIR=/models-cache
VOLUME ["/models-cache"]
```

That means the Nuxt app will use `/models-cache` inside the container, and Docker will
attach a persistent volume there when you run the container with `-v`.

### Docker Volume Cache Example

If you want Docker to download model files on first launch and reuse them on later redeploys,
mount a persistent volume at the same cache path the app uses.

The build does not need to copy model files manually. The first container start writes them
into the mounted volume, and subsequent starts reuse whatever is already there.

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app

COPY . .

ENV NUXT_LOCAL_MODEL_CACHE_DIR=/models-cache
RUN pnpm run build

FROM node:22-alpine
WORKDIR /app

ENV NUXT_LOCAL_MODEL_CACHE_DIR=/models-cache
VOLUME ["/models-cache"]

COPY --from=build /app/.output ./.output
COPY --from=deps /app/node_modules ./node_modules

CMD ["node", ".output/server/index.mjs"]
```

Use this as a template in your Nuxt Docker build if you want a persistent cache path.
At runtime, the mounted volume should be attached to `/models-cache`, and the app will
download missing models into that volume the first time it runs.

In other words:

- your local dev cache can be `./.ai-models`
- your Docker cache can be `/models-cache`
- both are fine as long as the app config matches the environment it runs in

### Naming Rule

- `useLocalModel()` / `useDecisionModel()` are for frontend Vue components, pages, and composables
- `getLocalModel()` / `getDecisionModel()` are for `server/api` routes and Nitro utilities

Both use the same underlying model-loading logic, so the runtime behavior stays consistent.

### Decision Models

Decision models answer **bounded questions with probabilities** instead of
generating text. They use three primitives:

| Primitive | Question                              | Returns                                             |
| --------- | ------------------------------------- | --------------------------------------------------- |
| `noul`    | Is this true?                         | `noul` (0..1)                                       |
| `choice`  | Which of these options?               | `choice`, `probabilities`, `confidence`             |
| `score`   | Where does this sit on these levels?  | `score`, `probabilities`, `confidence`, `legend`    |

Register one in `nuxt.config.ts` under `decisionModels`. `source` accepts a
local directory (or `.onnx` file), a full `https://` URL, or a Hugging Face id:

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    decisionModels: {
      triage: {
        // Local directory holding your ONNX model files.
        source: "./models/triage",

        // Optional. Defaults to the bundled ONNX Runtime adapter.
        adapter: "~/decision-adapter",
      },
      sharedPrefix: {
        // Any of these works — no manual download needed:
        // source: "my-org/my-decision-model",
        // source: "my-org/my-decision-model@cf92c2f", // pinned revision
        // source: "https://huggingface.co/my-org/my-decision-model/resolve/main/onnx/",
        source: "my-org/my-decision-model",
        adapter: "shared-prefix",
        // revision: "cf92c2f", // alternative to the @revision suffix
      },
    },
  },
})
```

Remote `source` values resolve on first use and are fetched to memory per
process (`.onnx` URLs download the weights; Hugging Face ids resolve to
`…/resolve/<revision>/` and fetch from there). Nothing is persisted to
`cacheDir` — `cacheDir` only applies to `models:` via Transformers.js.
Pass `fetch` in the definition to proxy or authenticate those downloads.
`revision` defaults to `main` — pin a commit for reproducible deploys.

Then evaluate it:

```vue
<script setup lang="ts">
const triage = await useDecisionModel("triage")

const { answers } = await triage.decide({
  state: "We were billed twice. Please refund the duplicate.",
  questions: {
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        billing: "invoices, payments and refunds",
        technical: "bugs and integration problems",
        other: "everything else",
      },
    },
    urgency: {
      type: "score",
      instructions: "How urgent does this look?",
      criteria: ["not urgent", "soon", "blocking"],
    },
    wants_refund: {
      type: "noul",
      instructions: "Does the user explicitly ask for a refund?",
    },
  },
})

answers.department.choice // "billing"
answers.department.confidence // 0.78
answers.wants_refund.noul // 0.96
</script>
```

Questions are validated before inference: `choice` needs 2–255 options,
`score` needs 2–10 levels, and every question needs `instructions`. This is
what bounds the answer space, so a `choice` can only ever return one of the
options you supplied.

#### Runtimes

Pick by graph layout:

| Your model looks like… | `adapter:` | What runs |
|---|---|---|
| Single-graph encoder + head — `input_ids` in, per-question logit tensors out | *omit* (default) | One forward pass; outputs matched by id → `outputMap` → single-pair fallback |
| Manifest directory — `manifest.json` + tokenizer + `model.onnx`, prefix/candidate feeds | `"shared-prefix"` | One prefix run per question, candidates batched |
| Anything else — reranker API, remote gateway, custom graph | `"~/my-adapter"` | Your `DecisionModelAdapter` factory; cache, dispose and validation reused |

The default runtime is **ONNX**, executed in-process by ONNX Runtime — no
external service, no Python export step. `onnxruntime-node` is a dependency of
this module, so the server needs no extra install; add `onnxruntime-web` for
the browser:

```bash
pnpm add onnxruntime-web
```

This adapter runs on **CPU by default** — the safe choice for CPU-only hosts.
Set `sessionOptions.executionProviders` (e.g. `["webgpu"]`) to override it.
It is deliberately tolerant about graph conventions:

- **Output names.** An output is matched to a question by its exact question
  id, then by `outputMap`, and finally by the single-output/single-question
  fallback. A graph naming its output `logits` therefore works via
  `outputMap: { logits: "department" }`. If no output matches any requested
  question, the call throws naming both sides rather than answering nothing.
- **Shapes.** `[batch, classes]` and `[1, classes]` tensors are read from their
  last axis, so a batched head needs no reshaping.
- **Fixed-width heads.** A 5-logit head answering a 3-option question is sliced
  to 3; a 2-logit head is padded with a neutral zero logit so every declared
  option still gets a probability and they still sum to 1.

Add `tokenizer: "<hf-id>"` when your checkpoint ships its own vocabulary —
the bundled tokenizer defaults to `Xenova/all-MiniLM-L6-v2` otherwise. Without
`maxTokens` the tokenizer's own context length applies and nothing is
truncated; set `maxTokens` to bound encoding, and the result then reports
`usage: { stateTokens, truncated }`.

> **Verification status.** The adapter's request validation, output mapping,
> shape handling and logit projection are covered by tests, and CPU
> execution through `onnxruntime-node` is confirmed. It has **not** been run
> end-to-end against a published decision checkpoint, so no specific model is
> claimed to work unmodified. A graph convention beyond the above needs a
> custom adapter.

#### Shared-prefix models

`adapter: "shared-prefix"` runs a manifest-directory export — `manifest.json` +
tokenizer + `model.onnx` — with the batching this layout uses: one prompt prefix
per question, all candidates scored in one batched forward pass. The same three
`source` forms work (local dir, URL, Hugging Face id):

```ts
decisionModels: {
  sharedPrefix: {
    source: "my-org/my-decision-model",
    adapter: "shared-prefix",
  },
}
```

Needs the optional peer `@huggingface/tokenizers` (the export's own
`tokenizer.json` is used, not MiniLM). `score` levels must be distinct finite
numbers — the score is the probability-weighted expectation over them. `noul`
accepts optional `criteria: { true/false }` (or `{ yes/no }`) meanings used as
the candidate documents; without them generic Yes/No phrasing is scored.

#### Custom Runtimes

For any other engine — a custom graph layout, a remote gateway, or a different
library — implement `DecisionModelAdapter` and point `adapter` at it. The
factory receives the resolved definition and returns a judge:

```ts
// decision-adapter.ts
import type { DecisionModelAdapter } from "nuxt-local-model"

export default function createAdapter(): DecisionModelAdapter {
  return {
    async decide(request) {
      return { answers: { /* your typed answers */ } }
    },
  }
}
```

#### Confidence

`confidence` is a distribution-concentration score, `1 - H(p) / ln(N)`: `0`
when probabilities are uniform, approaching `1` when one candidate dominates.
It is **not** a calibrated correctness estimate. Use `choice` or the winning
probability when you need a meaningful threshold, and treat low confidence as a
signal to abstain or escalate.

#### Server Routes

Nitro routes do not receive Nuxt's app auto-imports, so use `getDecisionModel()`
there. The module installs a Nitro plugin that publishes the server-side
config, so no extra setup is needed:

```ts
// server/api/triage.post.ts
import { getDecisionModel } from "nuxt-local-model/server"

export default defineEventHandler(async (event) => {
  const { state } = await readBody(event)
  const triage = await getDecisionModel("triage")
  return triage.decide({ state, questions: { /* ... */ } })
})
```

### Config Visibility

`runtimeConfig.public` is serialized to every client, so the module redacts
server-only fields from it:

- `decisionModels.*.adapter` — resolved to an absolute build-machine path
- `decisionModels.*.sessionOptions` — may hold private-host credentials

The full definitions live on the private `runtimeConfig.localModel`, which only
the server bundle receives. Adapter specifiers are resolved to absolute paths
at build time, so you can keep writing `~/my-adapter` in `nuxt.config.ts`.

Because `adapter` is redacted, a browser `useDecisionModel()` reading public
config sees no specifier and silently falls back to the bundled ONNX adapter —
pass a custom adapter through the `adapter` **option** of `useDecisionModel()`
to use your own in the browser.

### Worker Mode

You can choose where the model runs:

- `serverWorker: true` runs model inference in a Node worker thread on your Nuxt server
- `browserWorker: true` runs model inference in a browser Web Worker

This is useful if you want to keep heavy inference off the main request or UI thread.

Be careful with `browserWorker` and large models:

- the model must be downloaded into the user’s browser
- 100s of MB models can be slow or impractical for client delivery
- server worker mode is usually the better default for large models

### Server Worker vs Browser Worker

| Mode            | Where it runs                    | Best for                                                    | Tradeoff                                  |
| --------------- | -------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `serverWorker`  | Nuxt server / Node worker thread | Large models, shared cache, server-rendered apps            | Uses server CPU and memory                |
| `browserWorker` | User’s browser Web Worker        | Small client-side models, privacy-sensitive local inference | Model must be downloaded into the browser |

## Transformers.js Docs

For model/task behavior and runtime options, see the official Transformers.js docs:

- [Transformers.js docs](https://huggingface.co/docs/transformers.js/main)
- [Environment settings](https://huggingface.co/docs/transformers.js/main/api/env)
- [Pipeline behavior](https://huggingface.co/docs/transformers/en/main_classes/pipelines)

## Playground

This package includes a minimal playground app with an embedding example inside `playground/`.

The playground keeps the note list in the page and uses server routes for embeddings and search, so it demonstrates the server-backed flow end to end without a database.

Run it with:

```bash
npm run dev
```

## Notes

- This module is intentionally generic and does not ship opinionated preset models.
- The example playground shows how to wire an embedding model, but you can register any task/model combination supported by `@huggingface/transformers`.

[npm-version-src]: https://img.shields.io/npm/v/nuxt-local-model?style=flat-square
[npm-version-href]: https://www.npmjs.com/package/nuxt-local-model
[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-local-model?style=flat-square
[npm-downloads-href]: https://www.npmjs.com/package/nuxt-local-model
[license-src]: https://img.shields.io/npm/l/nuxt-local-model?style=flat-square
[license-href]: https://opensource.org/licenses/MIT
