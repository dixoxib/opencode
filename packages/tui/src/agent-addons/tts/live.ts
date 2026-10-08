// Live-speech scope. A click in the controls declares which parts it owns; the
// plugin then keeps speaking only those parts as their text grows.
//
// The legacy runtime streams text through v1 `message.part.updated` (the same
// part is re-published every ~50ms with more text), so membership is resolved
// against the live turn order on every update and the not-yet-spoken tail is
// derived from the per-part character count. That keeps a manual session from
// bleeding into neighbouring parts and lets "ab hier" pick up parts that did not
// exist yet when the button was clicked.
import { Tts } from "./engine"

export type SpeechPart = { id: string; type: string; text: string }

// Minimal projection of the sync store. The reader yields only speakable parts
// (text + reasoning); tool parts never reach here.
export type TurnReader = {
  messages: (sessionID: string) => readonly { id: string; role: string; parentID?: string }[]
  parts: (messageID: string) => readonly SpeechPart[]
}

export type ScopeKind = "part" | "after" | "turn" | "auto"

export type LiveScope = {
  key: string
  sessionID: string
  parentID: string
  kind: ScopeKind
  anchor?: string
  spoken: Map<string, number>
}

let scope: LiveScope | undefined

export const currentScope = () => scope
export const clearScope = () => {
  scope = undefined
}

// A turn spans every assistant message sharing the same parentID (tool loops),
// speakable parts in order.
export function turnParts(reader: TurnReader, sessionID: string, parentID: string): SpeechPart[] {
  return reader
    .messages(sessionID)
    .filter((message) => message.role === "assistant" && message.parentID === parentID)
    .flatMap((message) => [...reader.parts(message.id)])
}

function members(live: LiveScope, reader: TurnReader) {
  if (live.kind === "turn" || live.kind === "auto") return turnParts(reader, live.sessionID, live.parentID)
  const ordered = turnParts(reader, live.sessionID, live.parentID)
  const anchor = ordered.findIndex((part) => part.id === live.anchor)
  if (anchor < 0) return []
  return live.kind === "part" ? [ordered[anchor]] : ordered.slice(anchor + 1)
}

function open(live: Omit<LiveScope, "spoken">, parts: readonly SpeechPart[]) {
  Tts.begin(live.key)
  const spoken = new Map<string, number>()
  for (const part of parts) {
    Tts.append(live.key, part.text)
    spoken.set(part.id, part.text.length)
  }
  scope = { ...live, spoken }
}

export function startLive(input: {
  kind: "part" | "after" | "turn"
  key: string
  sessionID: string
  parentID: string
  anchor?: string
  parts: readonly SpeechPart[]
}) {
  open(input, input.parts)
}

// Auto mode owns the whole turn but never speaks reasoning.
export function startAuto(input: { key: string; sessionID: string; parentID: string }) {
  open({ ...input, kind: "auto" }, [])
}

// Speaks the growth of every part inside the live scope. Cheap: parts already
// spoken produce an empty tail and are skipped.
export function speakTail(reader: TurnReader) {
  const live = scope
  if (!live) return
  for (const part of members(live, reader)) {
    if (live.kind === "auto" && part.type !== "text") continue
    const tail = part.text.slice(live.spoken.get(part.id) ?? 0)
    live.spoken.set(part.id, part.text.length)
    if (tail) Tts.append(live.key, tail)
  }
}

export function finishLive() {
  const live = scope
  if (!live) return
  Tts.finish(live.key)
  clearScope()
}

export function stopLive() {
  Tts.stop()
  clearScope()
}
