<template>
  <main class="page">
    <header class="hero">
      <p class="eyebrow">nuxt-local-model playground</p>
      <h1>Server-run embeddings with an in-memory semantic search demo.</h1>
      <p class="lede">
        Add notes, let the Nuxt server embed them, and search them again without a database.
      </p>
    </header>

    <section class="panel">
      <div class="field">
        <label for="note">New note</label>
        <textarea id="note" v-model="note" rows="4" placeholder="Write note content..." />
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
            placeholder="
            Search for local embedding models
          "
            @input="searchNotes"
          />
        </div>

        <div class="results">
          <div v-for="item in searchResults" :key="item.id" class="card">
            <div class="card-row">
              <span>{{ formatScore(item.score) }}</span>
            </div>
            <p>{{ item.content }}</p>
          </div>
        </div>
      </article>

      <article class="panel">
        <h2>Stored notes</h2>
        <div class="list">
          <div v-for="item in notes" :key="item.id" class="card">
            <div class="card-row">
              <span>{{ item.embedding.length > 0 ? `${item.embedding.length} dims` : "pending" }}</span>
            </div>
            <p>{{ item.content }}</p>
          </div>
        </div>
      </article>
    </section>

    <section class="panel">
      <h2>Classify messages with bekko</h2>
      <p class="lede">
        hotchpotch/bekko-system-one-v0-17m is fetched from the Hub on first use and runs on the
        server through the module's shared-prefix decision adapter.
      </p>

      <div class="list">
        <div class="field">
          <label for="sample">Sample message</label>
          <select id="sample" v-model="sample">
            <option v-for="option in bekkoSamples" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
        </div>

        <div class="field">
          <label for="message">Message to classify</label>
          <textarea
            id="message"
            v-model="message"
            rows="4"
            placeholder="Write a customer message..."
          />
        </div>
      </div>

      <div class="actions">
        <button class="primary" :disabled="classifyBusy || !message.trim()" @click="classifyMessage">
          {{ classifyBusy ? "Classifying..." : "Classify" }}
        </button>
        <span class="status">{{ classifyStatus }}</span>
        <span v-if="elapsedMs !== null" class="status">{{ elapsedMs }} ms</span>
      </div>
    </section>

    <section v-if="classifyResult" class="grid">
      <article class="panel">
        <h2>Department</h2>
        <div class="results">
          <div class="card">
            <div class="card-row">
              <span>confidence</span>
              <span>{{ formatScore(classifyResult.answers.department.confidence ?? 0) }}</span>
            </div>
            <div
              v-for="(value, key) in classifyResult.answers.department.probabilities"
              :key="key"
              class="card-row"
            >
              <span>{{ key }}</span>
              <span>{{ formatScore(value) }}</span>
            </div>
            <p>{{ classifyResult.answers.department.choice }}</p>
          </div>
        </div>
      </article>

      <article class="panel">
        <h2>Wants refund?</h2>
        <div class="results">
          <div class="card">
            <div class="card-row">
              <span>P(yes)</span>
              <span>{{ formatScore(classifyResult.answers.wants_refund.noul) }}</span>
            </div>
            <div class="card-row">
              <span>confidence</span>
              <span>{{ formatScore(classifyResult.answers.wants_refund.confidence ?? 0) }}</span>
            </div>
            <div v-if="classifyResult.usage" class="card-row">
              <span>state tokens</span>
              <span>
                {{ classifyResult.usage.stateTokens
                }}<template v-if="classifyResult.usage.truncated"> (truncated)</template>
              </span>
            </div>
            <p>{{ classifyResult.answers.wants_refund.noul >= 0.5 ? "Yes" : "No" }}</p>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<script setup lang="ts">
type NoteItem = {
  id: string
  content: string
  embedding: number[]
}

type SearchItem = {
  id: string
  content: string
  score: number
}

type ChoiceAnswer = {
  type: "choice"
  choice: string
  probabilities: Record<string, number>
  confidence?: number
}

type NoulAnswer = {
  type: "noul"
  noul: number
  probabilities: Record<string, number>
  confidence?: number
}

type ClassifyResponse = {
  state: string
  answers: {
    department: ChoiceAnswer
    wants_refund: NoulAnswer
  }
  usage?: { stateTokens?: number; truncated?: boolean }
}

const note = ref("Transformers.js makes local embedding workflows easy in Nuxt.")
const query = ref("")
const busy = ref(false)
const status = ref("Ready")
const notes = ref<NoteItem[]>([])

const { data: notesData, refresh: refreshNotes } = await useFetch<NoteItem[]>("/api/demo/notes", {
  default: () => [],
})

const { data: searchData, refresh: refreshSearch } = await useFetch<SearchItem[]>(
  "/api/demo/search",
  {
    default: () => [],
    query: computed(() => ({ q: query.value })),
  },
)

watchEffect(() => {
  notes.value = notesData.value || []
})

onMounted(() => {
  void refreshNotes()
})

const searchResults = computed(() => searchData.value || [])

async function addNote() {
  const text = note.value.trim()
  if (!text) return
  busy.value = true
  status.value = "Embedding note on the server..."
  try {
    const created = await $fetch<{ ok: true; note: NoteItem }>("/api/demo/notes", {
      method: "POST",
      body: { text },
    })
    note.value = ""
    await refreshNotes()
    await refreshSearch()
    status.value = "Note stored in memory"
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Failed to store note"
  } finally {
    busy.value = false
  }
}

async function searchNotes() {
  busy.value = true
  status.value = "Searching on the server..."
  try {
    await refreshSearch()
    status.value = "Search updated"
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Search failed"
  } finally {
    busy.value = false
  }
}

function formatScore(score: number) {
  return `${Math.round(score * 100)}%`
}

const bekkoSamples = [
  "I was charged twice for order #4821. Please refund the duplicate payment.",
  "The dashboard crashes with a 500 error whenever I open the settings tab.",
  "Do you offer an annual plan? We'd like to upgrade from the starter tier.",
  "Can you send me a copy of last month's invoice?",
]

const sample = ref(bekkoSamples[0] ?? "")
const message = ref(bekkoSamples[0] ?? "")
const classifyBusy = ref(false)
const classifyStatus = ref("Ready")
const elapsedMs = ref<number | null>(null)
const classifyResult = ref<ClassifyResponse | null>(null)

watch(sample, (value) => {
  message.value = value
})

async function classifyMessage() {
  const state = message.value.trim()
  if (!state || classifyBusy.value) return
  classifyBusy.value = true
  classifyStatus.value = "Classifying on the server..."
  const started = performance.now()
  try {
    classifyResult.value = await $fetch<ClassifyResponse>("/api/bekko", {
      method: "POST",
      body: { state },
    })
    elapsedMs.value = Math.round(performance.now() - started)
    classifyStatus.value = "Classified"
  } catch (error) {
    classifyResult.value = null
    classifyStatus.value = error instanceof Error ? error.message : "Classification failed"
  } finally {
    classifyBusy.value = false
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 40px 20px 60px;
  background: linear-gradient(180deg, #f7f8fc 0%, #eef2ff 100%);
  color: #0f172a;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.hero,
.grid,
.panel {
  width: min(1080px, 100%);
  margin: 0 auto;
  max-width: 100%;
  padding: 0 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  margin-top: 20px;
}

.hero {
  margin-bottom: 20px;
}

.eyebrow {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: #4f46e5;
  font-size: 0.75rem;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 4rem);
  line-height: 1;
  max-width: 14ch;
}

.lede {
  margin: 12px 0 0;
  max-width: 65ch;
  color: #475569;
  line-height: 1.7;
}

.panel {
  background: #fff;
  border: 1px solid #dbe2f0;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
}

.grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 18px;
}

.field {
  display: grid;
  gap: 8px;
}

label {
  font-size: 0.9rem;
  color: #334155;
}

textarea,
input,
select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 14px;
  background: #fff;
  color: #0f172a;
  padding: 14px 16px;
  outline: none;
}

textarea:focus,
input:focus,
select:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
}

.primary {
  border: 0;
  border-radius: 999px;
  padding: 12px 18px;
  background: #111827;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.65;
  cursor: progress;
}

.status {
  color: #64748b;
  font-size: 0.95rem;
}

.results,
.list {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.card {
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 14px 16px;
  background: #f8fafc;
}

.card-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.card-row + .card-row {
  margin-top: 8px;
}

.card p {
  margin: 8px 0 0;
  color: #15191f;
  line-height: 1.6;
  overflow-wrap: anywhere;
  font-weight: bold;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
