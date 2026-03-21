<template>
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">nuxt-local-model playground</p>
      <h1>Local embeddings, semantic search, and zero database setup.</h1>
      <p class="lede">
        Add notes, build vectors in memory, and search them with a local Hugging Face embedding model.
        Everything runs inside this playground app.
      </p>
    </section>

    <section class="panel">
      <div class="field">
        <label for="note">New note</label>
        <textarea
          id="note"
          v-model="note"
          rows="4"
          placeholder="Write something meaningful to embed..."
        />
      </div>

      <div class="actions">
        <button class="primary" :disabled="busy" @click="addNote">
          {{ busy ? "Working..." : "Run embedding" }}
        </button>
        <span class="status">{{ status }}</span>
      </div>
    </section>

    <section class="grid">
      <article class="panel">
        <div class="field">
          <label for="query">Search</label>
          <input
            id="query"
            v-model="query"
            type="text"
            placeholder="Search notes by meaning..."
            @input="searchNotes"
          />
        </div>

        <div class="results">
          <div v-for="item in searchResults" :key="item.id" class="result">
            <div class="result-head">
              <strong>{{ item.text }}</strong>
              <span>{{ formatScore(item.score) }}</span>
            </div>
            <p>{{ item.preview }}</p>
          </div>
        </div>
      </article>

      <article class="panel">
        <h2>Stored notes</h2>
        <div class="list">
          <div v-for="item in notes" :key="item.id" class="note">
            <div class="note-head">
              <strong>{{ item.text }}</strong>
              <span>{{ item.embedding ? `${item.embedding.length} dims` : "pending" }}</span>
            </div>
            <p>{{ item.preview }}</p>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
type NoteItem = {
  id: string
  text: string
  preview: string
  embedding: number[] | null
}

type SearchItem = {
  id: string
  text: string
  preview: string
  score: number
}

const note = ref("Transformers.js makes local embedding workflows easy in Nuxt.")
const query = ref("local embedding search")
const status = ref("Ready")
const busy = ref(false)
const notes = ref<NoteItem[]>([
  { id: "1", text: "Nuxt local models", preview: "Run inference close to your app without a remote API.", embedding: null },
  { id: "2", text: "Docker cache volume", preview: "Persist model downloads across deploys.", embedding: null },
  { id: "3", text: "Worker threads", preview: "Keep heavy inference off the main server thread.", embedding: null },
])
const searchResults = ref<SearchItem[]>([])

let embedderPromise: Promise<ReturnType<typeof useLocalModel>> | null = null

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = useLocalModel("embedding")
  }
  return embedderPromise
}

function cosineSimilarity(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let aNorm = 0
  let bNorm = 0
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    aNorm += a[i] * a[i]
    bNorm += b[i] * b[i]
  }
  const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm)
  return denom === 0 ? 0 : dot / denom
}

async function embedText(text: string) {
  const embedder = await getEmbedder()
  const output = await embedder(text, { pooling: "mean", normalize: true })
  if (Array.isArray(output)) return output.map((value) => Number(value))
  if (output && typeof output === "object" && "data" in output) return Array.from((output as { data: ArrayLike<number> }).data).map(Number)
  return []
}

async function addNote() {
  const text = note.value.trim()
  if (!text) return
  busy.value = true
  status.value = "Embedding note..."
  try {
    const embedding = await embedText(text)
    notes.value = [
      {
        id: crypto.randomUUID(),
        text,
        preview: text.slice(0, 120),
        embedding,
      },
      ...notes.value,
    ]
    status.value = "Note stored in memory"
    await searchNotes()
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Failed to embed note"
  } finally {
    busy.value = false
  }
}

async function searchNotes() {
  const q = query.value.trim()
  if (!q) {
    searchResults.value = []
    return
  }

  busy.value = true
  status.value = "Searching embeddings..."
  try {
    const queryEmbedding = await embedText(q)
    searchResults.value = notes.value
      .filter((item): item is NoteItem & { embedding: number[] } => Array.isArray(item.embedding))
      .map((item) => ({
        id: item.id,
        text: item.text,
        preview: item.preview,
        score: cosineSimilarity(queryEmbedding, item.embedding),
      }))
      .sort((a, b) => b.score - a.score)
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Search failed"
  } finally {
    busy.value = false
  }
}

function formatScore(score: number) {
  return `${Math.round(score * 100)}%`
}

onMounted(() => {
  void searchNotes()
})
</script>

<style scoped>
.shell {
  min-height: 100vh;
  padding: 48px 24px 64px;
  background:
    radial-gradient(circle at top left, rgba(72, 94, 255, 0.16), transparent 28%),
    radial-gradient(circle at right top, rgba(35, 180, 140, 0.14), transparent 24%),
    linear-gradient(180deg, #0b1020 0%, #11162b 100%);
  color: #eef2ff;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.hero,
.panel {
  max-width: 1080px;
  margin: 0 auto;
}

.hero {
  margin-bottom: 24px;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #8ea0ff;
  font-size: 0.75rem;
  margin: 0 0 10px;
}

h1 {
  font-size: clamp(2.3rem, 5vw, 4.8rem);
  line-height: 0.98;
  margin: 0;
  max-width: 12ch;
}

.lede {
  max-width: 72ch;
  color: rgba(238, 242, 255, 0.76);
  font-size: 1.05rem;
  line-height: 1.65;
  margin-top: 14px;
}

.panel {
  background: rgba(10, 15, 30, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 24px;
  padding: 20px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(16px);
}

.grid {
  max-width: 1080px;
  margin: 20px auto 0;
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 20px;
}

.field {
  display: grid;
  gap: 8px;
}

label {
  color: #cfd7ff;
  font-size: 0.9rem;
}

textarea,
input {
  width: 100%;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(6, 10, 20, 0.8);
  color: #eef2ff;
  padding: 14px 16px;
  outline: none;
}

textarea:focus,
input:focus {
  border-color: rgba(123, 145, 255, 0.72);
  box-shadow: 0 0 0 4px rgba(123, 145, 255, 0.12);
}

.actions {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 16px;
}

.primary {
  border: 0;
  border-radius: 999px;
  padding: 12px 18px;
  color: #091120;
  background: linear-gradient(135deg, #9fb0ff, #86f3d1);
  font-weight: 700;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.7;
  cursor: progress;
}

.status {
  color: rgba(238, 242, 255, 0.72);
  font-size: 0.95rem;
}

.results,
.list {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.result,
.note {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 18px;
  padding: 14px 16px;
}

.result-head,
.note-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.result p,
.note p {
  margin: 8px 0 0;
  color: rgba(238, 242, 255, 0.72);
  line-height: 1.55;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
