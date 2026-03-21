export type DemoNote = {
  id: string
  content: string
  embedding: number[]
}

type DemoEmbedder = (input: string) => Promise<unknown>

const initialNotes: DemoNote[] = [
  {
    id: "1",
    content: "Run inference close to your app without a remote API.",
    embedding: [],
  },
  {
    id: "2",
    content: "Persist model downloads across deploys.",
    embedding: [],
  },
  {
    id: "3",
    content: "Keep heavy inference off the main server thread.",
    embedding: [],
  },
]

const notes: DemoNote[] = initialNotes.map((note) => ({
  ...note,
  embedding: [...note.embedding],
}))

export function getDemoNotes() {
  return notes
}

export function getDemoNote(id: string) {
  return notes.find((note) => note.id === id)
}

export function addDemoNote(note: DemoNote) {
  notes.unshift(note)
}

export function getPendingDemoNotesCount() {
  return notes.filter((note) => note.embedding.length === 0).length
}

export function toVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number")) {
      return value.map(Number)
    }

    for (const item of value) {
      const vector = toVector(item)
      if (vector.length > 1) return vector
    }

    return []
  }

  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>).map(Number)
  }

  if (value && typeof value === "object" && "data" in value) {
    return toVector((value as { data: unknown }).data)
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const vector = toVector(entry)
      if (vector.length > 0) return vector
    }
  }

  return []
}

export async function embedPendingDemoNotes(embedder: DemoEmbedder) {
  for (const note of notes) {
    if (note.embedding.length > 0) continue
    const output = await embedder(note.content)
    note.embedding = toVector(output)
  }
}
