import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID } from "./schema"

const SEPARATOR = "\n\n---\n\n"

// The trace is deliberately factual and lives in a synthetic user part: the TUI
// hides synthetic text, the model still reads it. Nothing is ever written into the
// assistant's own voice, because meta chatter there gets imitated, mistaken for
// real memory, or narrated back to the user.
const CAP = { files: 12, commands: 8, lookups: 6 }
const COMMAND_MAX = 80
const LOOKUP_MAX = 60

const EDIT_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch"])
const READ_TOOLS = new Set(["read", "ls", "lsp"])
const LOOKUP_TOOLS = new Set(["glob", "grep", "websearch", "webfetch"])

type Trace = {
  read: Set<string>
  edited: Set<string>
  commands: Set<string>
  lookups: Set<string>
}

const newTrace = (): Trace => ({ read: new Set(), edited: new Set(), commands: new Set(), lookups: new Set() })

/**
 * Prunes a conversation for `/prunecompact`: keeps text parts (tone + flow),
 * drops step/reasoning/tool parts, and fuses adjacent same-role messages into a
 * single text part. The work that was dropped is not lost — it is collected into
 * one synthetic user message placed at the prune boundary, which is right before
 * the kept tail. The original session stays untouched; the caller writes the
 * result into a fresh fork.
 *
 * `boundary` defaults to the last user message, so the final user + assistant
 * turn survives intact. Passing a seam message id moves the boundary there
 * instead: everything before that seam is pruned, the seam and what followed it
 * is kept.
 */
export function pruneCompactMessages(msgs: SessionV1.WithParts[], boundary?: MessageID): SessionV1.WithParts[] {
  const keepFrom = boundaryIndex(msgs, boundary)
  const out: SessionV1.WithParts[] = []
  const trace = newTrace()

  for (const [index, msg] of msgs.entries()) {
    if (index === keepFrom) {
      const note = traceMessage(trace, template(msgs, keepFrom))
      if (note) out.push(note)
    }
    if (index >= keepFrom) {
      out.push(msg)
      continue
    }

    if (msg.info.role === "user") {
      append(out, msg)
      continue
    }

    const text = assistantText(msg, trace)
    if (text) append(out, { info: msg.info, parts: [makeText(text, msg)] })
  }

  return out
}

function boundaryIndex(msgs: SessionV1.WithParts[], boundary?: MessageID) {
  if (boundary !== undefined) {
    const index = msgs.findIndex((msg) => msg.info.id === boundary)
    if (index >= 0) return index
  }
  return lastUserIndex(msgs)
}

function lastUserIndex(msgs: SessionV1.WithParts[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (msg.info.role !== "user") continue
    // A trace note is a synthetic-only user message: context for the model, not a
    // turn. Re-pruning a fork must not stop at it and cut away the real history.
    if (isSyntheticOnly(msg)) continue
    return i
  }
  return 0
}

function isSyntheticOnly(msg: SessionV1.WithParts) {
  return msg.parts.every((part) => "synthetic" in part && part.synthetic === true)
}

function assistantText(msg: SessionV1.WithParts, trace: Trace): string {
  const parts: string[] = []
  for (const part of msg.parts) {
    if (part.type === "text") {
      parts.push(part.text)
      continue
    }
    if (part.type === "tool") recordTool(trace, part)
  }
  return parts.join("\n")
}

// Only completed tool calls are worth a trace; a failed attempt is genuinely
// nothing the fork needs to remember.
function recordTool(trace: Trace, part: SessionV1.ToolPart) {
  if (part.state.status !== "completed") return
  const input = toolInput(part)
  if (EDIT_TOOLS.has(part.tool)) {
    for (const file of editedFiles(part, input)) trace.edited.add(file)
    return
  }
  if (READ_TOOLS.has(part.tool)) {
    const target = filePath(input)
    if (target) trace.read.add(target)
    return
  }
  if (LOOKUP_TOOLS.has(part.tool)) {
    const query = lookupArg(input)
    if (query) trace.lookups.add(cut(query, LOOKUP_MAX))
    return
  }
  if (part.tool === "bash") {
    const command = stringArg(input, ["command"])
    if (command) trace.commands.add(cut(command.replace(/\s+/g, " ").trim(), COMMAND_MAX))
  }
}

function toolInput(part: SessionV1.ToolPart): Record<string, unknown> {
  const input = (part.state as { input?: unknown }).input
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
}

// apply_patch carries no single path argument; the touched files are named by the
// patch header lines instead.
function editedFiles(part: SessionV1.ToolPart, input: Record<string, unknown>): string[] {
  if (part.tool !== "apply_patch") {
    const target = filePath(input)
    return target ? [target] : []
  }
  const patch = stringArg(input, ["patch", "input"])
  if (!patch) return []
  return [...patch.matchAll(/^\*\*\*\s+\w+\s+File:\s+(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}

function filePath(input: Record<string, unknown>) {
  return stringArg(input, ["filePath", "file_path", "path", "file"])
}

function lookupArg(input: Record<string, unknown>) {
  return stringArg(input, ["query", "pattern", "url", "pattern_path"])
}

function stringArg(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function cut(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function traceText(trace: Trace) {
  const lines = [
    ...listed("Files read", trace.read, CAP.files),
    ...listed("Files edited", trace.edited, CAP.files),
    ...listed("Commands run", trace.commands, CAP.commands),
    ...listed("Looked up", trace.lookups, CAP.lookups),
  ]
  if (!lines.length) return ""
  return `<session-trace>\nContext note about the earlier turns of this session. Not your own words, and nothing that needs an answer.\n${lines.join("\n")}\n</session-trace>`
}

function listed(label: string, items: Set<string>, cap: number): string[] {
  if (!items.size) return []
  const shown = [...items].slice(0, cap)
  const rest = items.size - shown.length
  return [`- ${label}: ${shown.join(", ")}${rest > 0 ? ` (+${rest} more)` : ""}`]
}

// The note is always a user message, so it needs a user-shaped template even when
// the boundary itself is a seam assistant message.
function template(msgs: SessionV1.WithParts[], keepFrom: number): SessionV1.User | undefined {
  const anchor =
    msgs
      .slice(0, keepFrom + 1)
      .findLast((msg) => msg.info.role === "user") ?? msgs.find((msg) => msg.info.role === "user")
  return anchor?.info as SessionV1.User | undefined
}

function traceMessage(trace: Trace, anchor: SessionV1.User | undefined) {
  const text = traceText(trace)
  if (!text || !anchor) return undefined
  const info: SessionV1.User = {
    ...anchor,
    id: MessageID.ascending(),
    role: "user",
    time: { created: Date.now() },
  }
  return {
    info,
    parts: [
      {
        type: "text" as const,
        text,
        synthetic: true,
        id: PartID.ascending(),
        sessionID: info.sessionID,
        messageID: info.id,
      },
    ],
  }
}

function append(out: SessionV1.WithParts[], next: SessionV1.WithParts) {
  const last = out[out.length - 1]
  if (!last || last.info.role !== next.info.role) {
    out.push(next)
    return
  }

  const sep = needsSeparator(last.info, next.info) ? SEPARATOR : "\n"
  const merged = [textOf(last.parts), textOf(next.parts)].filter(Boolean).join(sep)
  const parts: SessionV1.Part[] = []
  if (merged) parts.push(makeText(merged, last))
  parts.push(...nonTextParts(last.parts))
  parts.push(...nonTextParts(next.parts))
  out[out.length - 1] = { info: fuseInfo(last.info, next.info), parts }
}

function textOf(parts: SessionV1.Part[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => (part as SessionV1.TextPart).text)
    .join("\n")
}

function nonTextParts(parts: SessionV1.Part[]): SessionV1.Part[] {
  return parts.filter((part) => part.type !== "text")
}

function needsSeparator(prev: SessionV1.Info, next: SessionV1.Info): boolean {
  if (prev.role === "assistant" && next.role === "assistant") return prev.finish === "stop"
  return true
}

function fuseInfo(prev: SessionV1.Info, next: SessionV1.Info): SessionV1.Info {
  if (prev.role === "assistant" && next.role === "assistant") return { ...prev, finish: next.finish }
  return prev
}

// Fused transcript text keeps the original authorship: marking it synthetic would
// hide it from the TUI, where `synthetic` means injected context (see the trace
// note in traceMessage).
function makeText(text: string, msg: SessionV1.WithParts): SessionV1.TextPart {
  return {
    type: "text",
    text,
    id: PartID.ascending(),
    sessionID: msg.info.sessionID,
    messageID: msg.info.id,
  }
}

export * as SessionPrune from "./prune"
