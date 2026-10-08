import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionPrune } from "../../src/session/prune"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sid = SessionID.make("ses_test")

function text(value: string): SessionV1.TextPart {
  return { id: PartID.ascending(), sessionID: sid, messageID: MessageID.ascending(), type: "text", text: value }
}

function syntheticText(value: string): SessionV1.TextPart {
  return {
    id: PartID.ascending(),
    sessionID: sid,
    messageID: MessageID.ascending(),
    type: "text",
    text: value,
    synthetic: true,
  }
}

function reasoning(value: string): SessionV1.ReasoningPart {
  return {
    id: PartID.ascending(),
    sessionID: sid,
    messageID: MessageID.ascending(),
    type: "reasoning",
    text: value,
    time: { start: 0 },
  }
}

function stepStart(): SessionV1.StepStartPart {
  return { id: PartID.ascending(), sessionID: sid, messageID: MessageID.ascending(), type: "step-start" }
}

function stepFinish(): SessionV1.StepFinishPart {
  return {
    id: PartID.ascending(),
    sessionID: sid,
    messageID: MessageID.ascending(),
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function tool(
  name = "bash",
  input: Record<string, unknown> = {},
  status: "completed" | "error" = "completed",
): SessionV1.ToolPart {
  const base = {
    id: PartID.ascending(),
    sessionID: sid,
    messageID: MessageID.ascending(),
    type: "tool" as const,
    callID: "call",
    tool: name,
  }
  return status === "completed"
    ? {
        ...base,
        state: {
          status,
          input,
          output: "out",
          title: name,
          metadata: {},
          time: { start: 0, end: 0 },
        },
      }
    : { ...base, state: { status, input, error: "boom", time: { start: 0, end: 0 } } }
}

function user(id: string, parts: SessionV1.Part[]): SessionV1.WithParts {
  return {
    info: {
      id: MessageID.make(`msg_${id}`),
      sessionID: sid,
      role: "user",
      time: { created: 0 },
      agent: "build",
      model: { providerID: ProviderV2.ID.make("p"), modelID: ModelV2.ID.make("m") },
    } as SessionV1.User,
    parts,
  }
}

function assistant(id: string, parentID: string, finish: string | undefined, parts: SessionV1.Part[]): SessionV1.WithParts {
  return {
    info: {
      id: MessageID.make(`msg_${id}`),
      sessionID: sid,
      role: "assistant",
      parentID: MessageID.make(`msg_${parentID}`),
      modelID: ModelV2.ID.make("m"),
      providerID: ProviderV2.ID.make("p"),
      mode: "build",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish,
      time: { created: 0 },
    } as SessionV1.Assistant,
    parts,
  }
}

function flatten(msgs: SessionV1.WithParts[]): Array<{ role: string; finish?: string; parts: string[] }> {
  return msgs.map((msg) => ({
    role: msg.info.role,
    finish: msg.info.role === "assistant" ? msg.info.finish : undefined,
    parts: msg.parts.map((part) => (part.type === "text" ? (part as SessionV1.TextPart).text : `<${part.type}>`)),
  }))
}

const traces = (msgs: SessionV1.WithParts[]) =>
  flatten(msgs)
    .flatMap((msg) => msg.parts)
    .filter((part) => part.startsWith("<session-trace>"))

const trace = (msgs: SessionV1.WithParts[]) => traces(msgs)[0] ?? ""

describe("pruneCompactMessages", () => {
  test("keeps the final user + assistant turn intact and traces the dropped work", () => {
    const input = [
      user("u1", [text("hello")]),
      assistant("a1", "u1", "stop", [stepStart(), reasoning("think"), tool("read", { filePath: "src/a.ts" }), text("done"), stepFinish()]),
      user("u2", [text("second")]),
      assistant("a2", "u2", "stop", [text("answer")]),
    ]

    const out = SessionPrune.pruneCompactMessages(input)
    expect(flatten(out)).toEqual([
      { role: "user", parts: ["hello"] },
      { role: "assistant", finish: "stop", parts: ["done"] },
      { role: "user", parts: [trace(out)] },
      { role: "user", parts: ["second"] },
      { role: "assistant", finish: "stop", parts: ["answer"] },
    ])
    expect(trace(out)).toContain("- Files read: src/a.ts")
  })

  test("the trace is synthetic so the TUI hides it while the model still reads it", () => {
    const input = [
      user("u1", [text("hello")]),
      assistant("a1", "u1", "stop", [tool("read", { filePath: "src/a.ts" }), text("done")]),
      user("u2", [text("second")]),
      assistant("a2", "u2", "stop", [text("answer")]),
    ]

    const note = SessionPrune.pruneCompactMessages(input)[2]
    expect(note.info.role).toBe("user")
    expect(note.parts.every((part) => part.type === "text" && part.synthetic === true)).toBe(true)
  })

  test("assistant text carries no process markers of any kind", () => {
    const input = [
      user("u1", [text("hello")]),
      assistant("a1", "u1", "stop", [reasoning("think"), tool("bash", { command: "ls" }), text("done")]),
      user("u2", [text("second")]),
      assistant("a2", "u2", "stop", [text("answer")]),
    ]

    const spoken = flatten(SessionPrune.pruneCompactMessages(input))
      .filter((msg) => msg.role === "assistant")
      .flatMap((msg) => msg.parts)
      .filter((part) => !part.startsWith("<session-trace>"))
    expect(spoken.some((part) => part.includes("pruned"))).toBe(false)
  })

  test("trailing tool work before a user message is traced instead of vanishing", () => {
    const input = [
      user("u1", [text("los")]),
      assistant("a1", "u1", "tool-calls", [tool("bash", { command: "bun test" })]),
      user("u2", [text("weiter")]),
      assistant("a2", "u2", "stop", [text("fertig")]),
    ]

    expect(trace(SessionPrune.pruneCompactMessages(input))).toContain("- Commands run: bun test")
  })

  test("apply_patch files come from the patch headers", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", [
        tool("apply_patch", { patch: "*** Begin Patch\n*** Update File: src/x.ts\n@@\n*** End Patch" }),
      ]),
      user("u2", [text("next")]),
      assistant("a2", "u2", "stop", [text("final")]),
    ]

    expect(trace(SessionPrune.pruneCompactMessages(input))).toContain("- Files edited: src/x.ts")
  })

  test("failed tool calls leave no trace", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", [tool("edit", { filePath: "bad.ts" }, "error")]),
      user("u2", [text("next")]),
      assistant("a2", "u2", "stop", [text("final")]),
    ]

    expect(trace(SessionPrune.pruneCompactMessages(input))).toBe("")
  })

  test("overflow is capped and counted", () => {
    const many = Array.from({ length: 13 }, (_, index) => tool("read", { filePath: `f${index}.ts` }))
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", many),
      user("u2", [text("next")]),
      assistant("a2", "u2", "stop", [text("final")]),
    ]

    const line = trace(SessionPrune.pruneCompactMessages(input))
      .split("\n")
      .find((row) => row.startsWith("- Files read:"))
    expect(line).toContain("(+1 more)")
    expect(line).not.toContain("f12.ts")
  })

  test("a boundary message moves the cut there instead of the last user message", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", [tool("read", { filePath: "src/a.ts" }), text("vorher")]),
      assistant("a2", "u1", "stop", [text("seam summary")]),
      user("u2", [text("weiter")]),
      assistant("a3", "u2", "stop", [text("fertig")]),
    ]

    const out = SessionPrune.pruneCompactMessages(input, MessageID.make("msg_a2"))
    expect(flatten(out).map((msg) => msg.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"])
    expect(flatten(out)[3]).toEqual({ role: "assistant", finish: "stop", parts: ["seam summary"] })
    expect(trace(out)).toContain("- Files read: src/a.ts")
  })

  test("an unknown boundary falls back to the last user message", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", [tool("read", { filePath: "src/a.ts" }), text("vorher")]),
      user("u2", [text("weiter")]),
      assistant("a2", "u2", "stop", [text("fertig")]),
    ]

    expect(flatten(SessionPrune.pruneCompactMessages(input, MessageID.make("msg_nope")))).toEqual(
      flatten(SessionPrune.pruneCompactMessages(input)),
    )
  })

  test("a synthetic trace note is never the default boundary", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "stop", [tool("read", { filePath: "src/a.ts" }), text("answer")]),
      user("note", [syntheticText("<session-trace>\n- Files read: src/a.ts\n</session-trace>")]),
      assistant("a2", "note", "stop", [text("tail")]),
    ]

    const out = SessionPrune.pruneCompactMessages(input)
    // The note is skipped when looking for the boundary, so the real history is
    // kept and no second note gets stacked on top of the existing one.
    expect(out).toHaveLength(input.length)
    expect(traces(out)).toHaveLength(1)
    expect(flatten(out).map((msg) => msg.role)).toEqual(["user", "assistant", "user", "assistant"])
  })

  test("fused transcript parts stay visible instead of being marked synthetic", () => {
    const input = [
      user("u1", [text("first")]),
      user("u2", [text("second")]),
      assistant("a1", "u2", "stop", [text("answer")]),
      user("u3", [text("third")]),
      assistant("a2", "u3", "stop", [text("final")]),
    ]

    const fused = SessionPrune.pruneCompactMessages(input)[0]
    expect(fused.parts.every((part) => part.type === "text" && part.synthetic !== true)).toBe(true)
  })

  test("fuses same-role user messages into one part with a separator", () => {
    const input = [
      user("u1", [text("first")]),
      user("u2", [text("second")]),
      assistant("a1", "u2", "stop", [text("answer")]),
      user("u3", [text("third")]),
      assistant("a2", "u3", "stop", [text("final")]),
    ]

    const out = SessionPrune.pruneCompactMessages(input)
    expect(flatten(out)[0]).toEqual({ role: "user", parts: ["first\n\n---\n\nsecond"] })
  })

  test("fuses assistant steps of one turn into one part without a separator", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", [text("step one")]),
      assistant("a2", "u1", "stop", [text("step two")]),
      user("u2", [text("next")]),
      assistant("a3", "u2", "stop", [text("final")]),
    ]

    const out = SessionPrune.pruneCompactMessages(input)
    expect(flatten(out).filter((msg) => msg.role === "assistant")[0]).toEqual({
      role: "assistant",
      finish: "stop",
      parts: ["step one\nstep two"],
    })
  })

  test("drops assistant messages that become empty after pruning", () => {
    const input = [
      user("u1", [text("go")]),
      assistant("a1", "u1", "tool-calls", [stepStart(), tool("ls", {}), stepFinish()]),
      assistant("a2", "u1", "stop", [text("answer")]),
      user("u2", [text("next")]),
      assistant("a3", "u2", "stop", [text("final")]),
    ]

    expect(
      flatten(SessionPrune.pruneCompactMessages(input))
        .filter((msg) => !msg.parts.some((part) => part.startsWith("<session-trace>")))
        .map((msg) => msg.role),
    ).toEqual(["user", "assistant", "user", "assistant"])
  })
})
