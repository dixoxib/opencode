/**
 * Base64-encode long strings (>10k chars) to prevent JSON double‑escaping
 * corruption in SQLite TEXT columns (Drizzle `text({ mode: "json" })`).
 *
 * Write path: encodeLongStrings(obj) before projector inserts into DB.
 * Read path:  decodeLongStrings(obj) after Drizzle deserializes from DB.
 */

const MARKER = "__B64__"
const THRESHOLD = 10_000

export function encodeLongStrings(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    if (obj.length > THRESHOLD) return MARKER + Buffer.from(obj).toString("base64")
    return obj
  }
  if (Array.isArray(obj)) return obj.map(encodeLongStrings)
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      result[key] = encodeLongStrings((obj as Record<string, unknown>)[key])
    }
    return result
  }
  return obj
}

export function decodeLongStrings(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    if (obj.startsWith(MARKER)) {
      return Buffer.from(obj.slice(MARKER.length), "base64").toString("utf8")
    }
    return obj
  }
  if (Array.isArray(obj)) return obj.map(decodeLongStrings)
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      result[key] = decodeLongStrings((obj as Record<string, unknown>)[key])
    }
    return result
  }
  return obj
}
