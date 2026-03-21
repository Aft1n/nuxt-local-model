import { embedPendingDemoNotes, getDemoNotes, toVector } from "../../utils/demo-memory"
import { getLocalModel } from "nuxt-local-model/server"

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

export default defineEventHandler(async (event) => {
  const { q = "" } = getQuery(event) as { q?: string }
  const query = String(q).trim()

  if (!query) {
    return []
  }

  const embedder = await getLocalModel("embedding")
  await embedPendingDemoNotes((content) => embedder(content))
  const output = await embedder(query)
  const queryEmbedding = toVector(output)

  return getDemoNotes()
    .filter((item) => item.embedding.length > 0)
    .map((item) => ({
      id: item.id,
      content: item.content,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    }))
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
})
