// Speaks text via a local piper-tts install, playing WAVs through paplay.
//
// The controller models one active playback session at a time. A session is a
// producer/consumer pipeline:
//   - append() feeds whole, already-complete text units (parts / turns). Text is
//     cleaned, then split into quote-delimited segments so each segment gets its
//     own language (a German quote inside English prose stays German without
//     flipping the surrounding voice), then chunked (whole paragraphs where
//     possible; the pending queue).
//   - the synth loop renders pending chunks to WAV *ahead* of playback
//     (prefetch), so the play loop never waits on synthesis mid-stream.
//   - the play loop plays rendered WAVs in order and deletes them after.
//
// A session stays "live" (open for more appends) until finish() is called, so
// auto mode can keep speaking a turn as new parts complete without gaps.
//
// Paths default to the standard piper install but can be overridden with
// OPENCODE_TTS_PIPER / OPENCODE_TTS_VOICES / OPENCODE_TTS_PLAYER. The chunk cap
// is OPENCODE_TTS_CHUNK_CAP (see core Flag).
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { unlink } from "node:fs/promises"
import { cleanForSpeech, toChunks, toSpeechSegments } from "./text"
import { setSpeakingKey } from "./state"
import { Flag } from "@opencode-ai/core/flag/flag"

const PIPER = process.env["OPENCODE_TTS_PIPER"] ?? join(homedir(), ".local/bin/piper")
const VOICE_DIR = process.env["OPENCODE_TTS_VOICES"] ?? join(homedir(), ".local/share/piper/voices")
const PLAYER = process.env["OPENCODE_TTS_PLAYER"] ?? "paplay"
const VOICE: Record<"de" | "en", string> = {
  de: join(VOICE_DIR, "de_DE-kerstin-low.onnx"),
  en: join(VOICE_DIR, "en_US-ryan-high.onnx"),
}

const PREFETCH = 2 // render at most this many WAVs ahead of playback
const DEFAULT_CHUNK_CAP = 400 // max chars per synth chunk (OPENCODE_TTS_CHUNK_CAP overrides)

type Chunk = { text: string; language: "de" | "en" }

type Session = {
  key: string
  pending: Chunk[]
  rendered: string[] // wav paths ready to play
  live: boolean // still accepting appends
  cancelled: boolean
  synthDone: boolean
  piper?: ReturnType<typeof Bun.spawn>
  player?: ReturnType<typeof Bun.spawn>
  gate: ReturnType<typeof makeGate>
}

let active: Session | undefined
let counter = 0

// A resettable "condition variable": wait() resolves on the next wake(). Because
// JS is single-threaded, a loop that checks state synchronously and only then
// awaits wait() cannot miss a wake().
function makeGate() {
  let resolve: (() => void) | undefined
  let promise = new Promise<void>((r) => (resolve = r))
  return {
    wait: () => promise,
    wake: () => {
      resolve?.()
      promise = new Promise<void>((r) => (resolve = r))
    },
  }
}

function begin(key: string) {
  stop()
  const session: Session = {
    key,
    pending: [],
    rendered: [],
    live: true,
    cancelled: false,
    synthDone: false,
    gate: makeGate(),
  }
  active = session
  setSpeakingKey(key)
  void synthLoop(session)
  void playLoop(session)
}

// Queues text for the session owning `key`; writes against another or already
// stopped session are dropped so a stale producer cannot leak into new playback.
function append(key: string, text: string) {
  if (!active || active.key !== key || active.cancelled) return
  const clean = cleanForSpeech(text)
  if (!clean) return
  const cap = Number(Flag.OPENCODE_TTS_CHUNK_CAP) || DEFAULT_CHUNK_CAP
  for (const segment of toSpeechSegments(clean)) {
    for (const chunk of toChunks(segment.text, cap)) active.pending.push({ text: chunk, language: segment.language })
  }
  active.gate.wake()
}

function finish(key: string) {
  if (!active || active.key !== key) return
  active.live = false
  active.gate.wake()
}

function stop() {
  const session = active
  if (!session) return
  session.cancelled = true
  session.live = false
  session.piper?.kill()
  session.player?.kill()
  session.pending = []
  session.gate.wake()
  active = undefined
  setSpeakingKey(undefined)
}

// Convenience for complete, one-shot utterances (manual clicks): a whole part or
// a sequence of parts. Each entry is spoken as its own append (its own language).
function play(key: string, parts: string | string[]) {
  begin(key)
  for (const part of Array.isArray(parts) ? parts : [parts]) append(key, part)
  finish(key)
}

async function synthLoop(session: Session) {
  while (!session.cancelled) {
    if (session.pending.length === 0) {
      if (!session.live) break
      await session.gate.wait()
      continue
    }
    if (session.rendered.length >= PREFETCH) {
      await session.gate.wait()
      continue
    }
    const chunk = session.pending.shift()!
    const wav = await renderWav(session, chunk)
    if (session.cancelled) {
      if (wav) await unlink(wav).catch(() => {})
      break
    }
    if (wav) session.rendered.push(wav)
    session.gate.wake()
  }
  session.synthDone = true
  session.gate.wake()
}

async function playLoop(session: Session) {
  while (!session.cancelled) {
    if (session.rendered.length === 0) {
      if (session.synthDone) break
      await session.gate.wait()
      continue
    }
    const wav = session.rendered.shift()!
    session.gate.wake() // release synth backpressure
    await playWav(session, wav)
    await unlink(wav).catch(() => {})
  }
  for (const leftover of session.rendered) await unlink(leftover).catch(() => {})
  session.rendered = []
  if (active === session) {
    active = undefined
    setSpeakingKey(undefined)
  }
}

async function renderWav(session: Session, chunk: Chunk) {
  const out = join(tmpdir(), `opencode-tts-${process.pid}-${Date.now()}-${counter++}.wav`)
  const piper = Bun.spawn([PIPER, "-m", VOICE[chunk.language], "-f", out], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  })
  session.piper = piper
  piper.stdin.write(chunk.text)
  piper.stdin.end()
  const code = await piper.exited
  session.piper = undefined
  if (code !== 0 || session.cancelled) {
    await unlink(out).catch(() => {})
    return undefined
  }
  return out
}

async function playWav(session: Session, wav: string) {
  const player = Bun.spawn([PLAYER, wav], { stdout: "ignore", stderr: "ignore" })
  session.player = player
  await player.exited
  session.player = undefined
}

export const Tts = { begin, append, finish, stop, play }
