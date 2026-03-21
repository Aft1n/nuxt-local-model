import { getDemoNotes } from "../../utils/demo-memory"

export default defineEventHandler(async () => {
  return getDemoNotes()
})
