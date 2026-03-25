import { addDemoNote, embedPendingDemoNotes, getDemoNote, getPendingDemoNotesCount } from "../../utils/demo-memory"
import { getLocalModel } from "../../../../src/runtime/server"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text?: string }>(event)
  const text = body?.text?.trim()

  if (!text) {
    throw createError({ statusCode: 400, statusMessage: "Text is required" })
  }

  const createdNote = {
    id: crypto.randomUUID(),
    content: text,
    embedding: [],
  }
  addDemoNote(createdNote)

  const pendingCount = getPendingDemoNotesCount()
  console.info(`🧪 [playground] embedding ${pendingCount} note${pendingCount === 1 ? "" : "s"} on the server`)
  const embedder = await getLocalModel("embedding", { pooling: "mean", normalize: true })
  await embedPendingDemoNotes((content) => embedder(content))

  const embedded = getDemoNote(createdNote.id) || createdNote
  console.info(`🧪 [playground] embedded note ${createdNote.id} (${embedded.embedding.length} dims)`)
  return { ok: true, note: embedded }
})
