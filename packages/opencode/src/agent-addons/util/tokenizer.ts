import tokenizerData from "../tokenizer/deepseek-tokenizer.json"

// ── Types ──────────────────────────────────────────────

type TokenBytes = Uint8Array
type Rank = number

interface TokenizerJSON {
  model: {
    vocab: Record<string, number>
    merges: string[]
  }
  added_tokens?: { id: number; content: string; special: boolean }[]
}

// ── Encoding state ─────────────────────────────────────

let _encoder: { encode: (text: string) => number } | null = null
let _ready: Promise<void> | null = null

export function hasEncoder(): boolean {
  return _encoder !== null
}

// ── BPE encode ─────────────────────────────────────────

interface Piece {
  id: number
  len: number
  bytes: Uint8Array
  prev: number
  next: number
}

function encode(text: string, ranks: Map<string, number>): number {
  const input = text || ""
  if (input.length === 0) return 0

  const raw = new TextEncoder().encode(input)
  const n = raw.length
  if (n === 0) return 0

  // Linked pieces — each starts as a single byte
  const pieces = new Array<Piece>(n)
  for (let i = 0; i < n; i++) {
    pieces[i] = {
      id: i,
      len: 1,
      bytes: new Uint8Array([raw[i]]),
      prev: i - 1,
      next: i + 1,
    }
  }
  pieces[n - 1].next = -1

  // Min‑heap: (rank, left_id)
  type HeapEntry = { rank: number; left: number }
  const heap: HeapEntry[] = []
  const pos = new Map<number, number>()
  let nextId = n

  function hpSwap(i: number, j: number) {
    ;[heap[i], heap[j]] = [heap[j], heap[i]]
    pos.set(heap[i].left, i)
    pos.set(heap[j].left, j)
  }

  function hpPush(e: HeapEntry) {
    heap.push(e)
    let i = heap.length - 1
    pos.set(e.left, i)
    while (i > 0 && heap[i].rank < heap[(i - 1) >> 1].rank) {
      hpSwap(i, (i - 1) >> 1)
      i = (i - 1) >> 1
    }
  }

  function hpPop(): HeapEntry | null {
    if (heap.length === 0) return null
    const top = heap[0]
    pos.delete(top.left)
    if (heap.length === 1) {
      heap.pop()
      return top
    }
    heap[0] = heap.pop()!
    pos.set(heap[0].left, 0)
    let i = 0
    while (true) {
      let min = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < heap.length && heap[l].rank < heap[min].rank) min = l
      if (r < heap.length && heap[r].rank < heap[min].rank) min = r
      if (min === i) break
      hpSwap(i, min)
      i = min
    }
    return top
  }

  function pairRank(a: Piece, b: Piece): number {
    const merged = new Uint8Array(a.len + b.len)
    for (let i = 0; i < a.len; i++) merged[i] = a.bytes[i]
    for (let i = 0; i < b.len; i++) merged[a.len + i] = b.bytes[i]
    const key = Buffer.from(merged).toString("base64")
    return ranks.get(key) ?? Number.MAX_SAFE_INTEGER
  }

  // Initialise heap with every adjacent pair
  for (let i = 0; i < n - 1; i++) {
    const r = pairRank(pieces[i], pieces[i + 1])
    if (r !== Number.MAX_SAFE_INTEGER) hpPush({ rank: r, left: pieces[i].id })
  }

  // Merge loop — each successful merge reduces token count by 1
  // Piece id == array index (never removed, only soft‑deleted) so O(1) lookup
  let merges = 0
  while (heap.length > 0) {
    const entry = hpPop()!
    const a = pieces[entry.left]
    if (!a || a.next === -1) continue
    const b = pieces[a.next]
    if (!b) continue

    const actual = pairRank(a, b)
    if (actual !== entry.rank) {
      if (actual !== Number.MAX_SAFE_INTEGER) hpPush({ rank: actual, left: a.id })
      continue
    }

    // Merge a + b
    const merged = new Uint8Array(a.len + b.len)
    merged.set(a.bytes, 0)
    merged.set(b.bytes, a.len)
    const node: Piece = {
      id: nextId++,
      len: a.len + b.len,
      bytes: merged,
      prev: a.prev,
      next: b.next,
    }
    pieces.push(node)

    if (a.prev !== -1) pieces[a.prev].next = node.id
    if (b.next !== -1) pieces[b.next].prev = node.id
    a.next = -1
    b.prev = -1
    b.next = -1

    if (node.prev !== -1) {
      const r = pairRank(pieces[node.prev], node)
      if (r !== Number.MAX_SAFE_INTEGER) hpPush({ rank: r, left: pieces[node.prev].id })
    }
    if (node.next !== -1) {
      const r = pairRank(node, pieces[node.next])
      if (r !== Number.MAX_SAFE_INTEGER) hpPush({ rank: r, left: node.id })
    }
    merges++
  }

  return n - merges
}

// ── Load + build ranks ─────────────────────────────────

async function load() {
  try {
    const data = tokenizerData as TokenizerJSON
    const { vocab, merges } = data.model

    const ranks = new Map<string, number>()

    // Decode byte‑level tokens (GPT‑2/DeepSeek mapping):
    //   • 0x00–0x1F + 0x20 (controls, space) → shifted: cp − 0x100
    //   • 0x21–0x7E (printable ASCII)         → identity: cp
    //   • 0x80–0xFF (Latin‑1)                  → identity: cp
    //   • 0x7F (DEL) → shifted (rare, rarely in vocab)
    //   • anything else → UTF‑8 fallback
    function tokenBytes(token: string): Uint8Array {
      const out: number[] = []
      for (let i = 0; i < token.length; i++) {
        const cp = token.codePointAt(i)!
        if (cp != null && cp > 0xffff) i++ // skip low surrogate
        if (cp >= 0x100 && cp < 0x200) out.push(cp - 0x100)
        else if (cp <= 0xff) out.push(cp)
        else {
          const b = new TextEncoder().encode(String.fromCodePoint(cp))
          for (const v of b) out.push(v)
        }
      }
      return new Uint8Array(out)
    }

    const tokenToBytes = new Map<string, Uint8Array>()
    for (const token of Object.keys(vocab)) {
      tokenToBytes.set(token, tokenBytes(token))
    }

    // Single bytes: rank 0–255
    for (let b = 0; b < 256; b++) {
      const key = Buffer.from(new Uint8Array([b])).toString("base64")
      ranks.set(key, b)
    }

    // Merges: rank 256+
    for (let i = 0; i < merges.length; i++) {
      const parts = merges[i].split(" ")
      const a = parts[0]
      const b = parts.slice(1).join(" ")
      const aBytes = tokenToBytes.get(a)
      const bBytes = tokenToBytes.get(b)
      if (!aBytes || !bBytes) continue
      const merged = new Uint8Array(aBytes.length + bBytes.length)
      merged.set(aBytes)
      merged.set(bBytes, aBytes.length)
      const key = Buffer.from(merged).toString("base64")
      ranks.set(key, 256 + i)
    }

    _encoder = {
      encode(text: string) {
        return encode(text, ranks)
      },
    }
  } catch {
    // _encoder stays null → fallback used
  }
}

export function count(text: string): number {
  if (_encoder) return _encoder.encode(text)
  return Math.max(0, Math.round((text || "").length / 4))
}

export function countAsync(text: string): Promise<number> {
  if (!_ready) _ready = load()
  return _ready.then(() => count(text))
}

export function countBatch(texts: string[]): number {
  if (_encoder) {
    let total = 0
    for (const t of texts) total += _encoder.encode(t)
    return total
  }
  let total = 0
  for (const t of texts) total += Math.max(0, Math.round((t || "").length / 4))
  return total
}

// Kick off loading at module import
_ready = load().catch(() => { _ready = null })