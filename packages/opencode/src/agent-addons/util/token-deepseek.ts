import { count as _count, countAsync, hasEncoder } from "@/agent-addons/util/tokenizer"

/**
 * Per‑assistant‑turn structural overhead (step‑start/step‑finish, metadata).
 * Calibrated against 213‑turn session export: 0.22% error vs API total.
 */
export const PER_TURN_OVERHEAD = 62

let _loaded = false

async function load() {
  try {
    if (hasEncoder()) {
      _loaded = true
    } else {
      await countAsync("")
      _loaded = true
    }
  } catch {
    // tokenizer not available, use chars/4 fallback
  }
}

export function count(text: string): number {
  if (_loaded) return _count(text)
  return Math.round(text.length / 4)
}

export function estimate(text: string): number {
  if (!text) return 0
  const hit = _cache.get(text)
  if (hit !== undefined) return hit
  const v = Math.max(1, count(text))
  _cache.set(text, v)
  return v
}

// Content-addressable session cache: fast BPE token-lookups, no eviction until compaction.
const _cache = new Map<string, number>()

// Hooked by compaction to drop stale entries after a checkpoint replaces older messages.
export function compactCache() {
  _cache.clear()
}

export { hasEncoder }
export { load }

// kick off async load
load()

