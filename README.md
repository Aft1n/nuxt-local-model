# Nuxt Local Model

A Nuxt module for easily integrating local Hugging Face transformer models into your Nuxt 4 application.

## Features

- Easily use local models in your Nuxt app
- Supports any Hugging Face task and model you want to configure
- Auto-imported composable, `useLocalModel()` by default
- Fully configurable via `nuxt.config.ts`
- Supports changing model names, tasks, and settings per usage
- Optional worker-backed execution on the server or in the browser
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
npm install nuxt-local-model @huggingface/transformers

# Using yarn
yarn add nuxt-local-model @huggingface/transformers

# Using pnpm
pnpm add nuxt-local-model @huggingface/transformers

# Using bun
bun add nuxt-local-model @huggingface/transformers
```

Then, add it to your Nuxt config:

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
})
```

## Usage

Once installed, you can use `useLocalModel()` anywhere in your Nuxt app.

### Basic Example

```vue
<script setup lang="ts">
const embedder = await useLocalModel("embedding")
const output = await embedder("Nuxt local model example")
</script>
```

### Defining Models in `nuxt.config.ts`

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    cacheDir: "./.ai-models", // where downloaded model files are cached on disk
    allowRemoteModels: true, // allow fetching missing models from Hugging Face
    allowLocalModels: true, // allow reusing cached / mounted model files
    defaultTask: "feature-extraction", // default pipeline type when a model entry does not override it
    serverWorker: false, // run inference in a Node worker thread on the server
    browserWorker: false, // run inference in a browser Web Worker; avoid this for very large models
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

## Configuration Options

You can configure the module in your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ["nuxt-local-model"],
  localModel: {
    cacheDir: "./.ai-models", // persistent cache path for downloaded model assets
    allowRemoteModels: true, // download from Hugging Face if not yet cached
    allowLocalModels: true, // reuse local cache or mounted volume contents
    defaultTask: "feature-extraction", // default for aliases that do not override task
    serverWorker: true, // use a Node worker thread so inference does not block the main server thread
    browserWorker: false, // enable only if you intentionally want browser-side inference
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

### Cache Directory

The cache directory controls where downloaded model files are stored.

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
- the first container start downloads missing models into the mounted volume
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

### Changing the Composable Name

This module currently exposes `useLocalModel()` by default.

If you want to add your own wrapper or alias in the app, you can do that on top of the composable without changing the module internals.

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

Run it with:

```bash
npm run dev
```

## Publishing

If you want to publish this module to GitHub and npm:

1. `cd nuxt-llm-module`
2. `git init`
3. commit the files
4. create a GitHub repository
5. connect the remote and push
6. run `npm login`
7. publish with `npm publish --access public`

## Notes

- This module is intentionally generic and does not ship opinionated preset models.
- The example playground shows how to wire an embedding model, but you can register any task/model combination supported by `@huggingface/transformers`.
