import { embedPendingDemoNotes, getDemoNotes, toVector } from "../../utils/demo-memory"
import { getLocalModel } from "../../../../src/runtime/server"

function cosineSimilarity(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let aNorm = 0
  let bNorm = 0
  for (let i = 0; i < len; i += 1) {
    const aValue = a[i] ?? 0
    const bValue = b[i] ?? 0
    dot += aValue * bValue
    aNorm += aValue * aValue
    bNorm += bValue * bValue
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

  const embedder = await getLocalModel("embedding", { pooling: "mean", normalize: true })
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
