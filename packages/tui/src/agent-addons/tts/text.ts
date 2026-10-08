// Turns assistant markdown into something worth listening to. Code blocks,
// inline code, links, URLs and file:line references read terribly out loud, so
// they are stripped rather than spoken verbatim.

const GERMAN_MARKERS =
  /\b(und|nicht|du|ich|ist|der|die|das|ein|eine|mit|auf|für|wir|wird|kann|nur|schon|jetzt|noch|auch|dass|sich|ohne|wie|hast|hat)\b/gi

export function detectLanguage(text: string): "de" | "en" {
  if (/[äöüß]/i.test(text)) return "de"
  return (text.match(GERMAN_MARKERS)?.length ?? 0) >= 1 ? "de" : "en"
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function cleanForSpeech(input: string): string {
  return input
    .replace(/\[REDACTED\]/g, " ") // encrypted reasoning placeholder
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]*)`/g, "$1") // inline code: preserve content, drop backticks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> label
    .replace(/https?:\/\/\S+/g, " ") // urls
    .replace(/\b[\w./-]+:\d+(?::\d+)?\b/g, " ") // file:line refs
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "") // headings
    .replace(/^[ \t]*[-*+][ \t]+/gm, "") // bullet lists
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "") // ordered lists
    .replace(/^[ \t]*>[ \t]?/gm, "") // blockquotes
    .replace(/[*_~`>#|]/g, "") // stray markdown chars
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/ *\n */g, "\n") // trim spaces around line breaks
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs to one paragraph break
    .trim()
}

// Quote marks are dropped from speech and act as language boundaries, so a
// German quote inside English prose (or the reverse) keeps its own voice
// instead of flipping the voice for the whole surrounding part. Straight single
// quotes are only treated as quotes when they are not word-internal, so
// contractions like "don't" survive.
const QUOTES = /[\u201E\u201C\u201D\u201A\u2018\u2019"]|'(?=\W|$)|(?<=\W|^)'/g

export function toSpeechSegments(clean: string): Array<{ text: string; language: "de" | "en" }> {
  return clean
    .split(QUOTES)
    .filter((segment) => segment.trim())
    .reduce<Array<{ text: string; language: "de" | "en" }>>((segments, text) => {
      const language = detectLanguage(text)
      const last = segments.at(-1)
      if (last?.language === language) last.text += text
      else segments.push({ text, language })
      return segments
    }, [])
}

// Split cleaned prose into sentence-sized chunks so playback can start early
// and stay interruptible instead of waiting on one long synthesis.
export function toSentences(clean: string): string[] {
  return clean
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Split into the largest chunks that still fit under `cap`, preferring whole
// paragraphs so piper gets maximum context for prosody/tonality. Paragraphs
// longer than the cap are bundled at sentence boundaries; a single sentence is
// never split mid-way (splitting mid-sentence sounds worse than a long render).
export function toChunks(clean: string, cap: number): string[] {
  const chunks: string[] = []
  for (const paragraph of clean.split(/\n{2,}/)) {
    const para = paragraph.replace(/\s+/g, " ").trim()
    if (!para) continue
    if (para.length <= cap) {
      chunks.push(para)
      continue
    }
    let buffer = ""
    for (const sentence of toSentences(para)) {
      if (buffer && buffer.length + 1 + sentence.length > cap) {
        chunks.push(buffer)
        buffer = sentence
        continue
      }
      buffer = buffer ? `${buffer} ${sentence}` : sentence
    }
    if (buffer) chunks.push(buffer)
  }
  return chunks
}
