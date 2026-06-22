import { Effect, Schema, Option } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { PartID } from "@/session/schema"

import { Service as RegistryService } from "./registry"
import DESCRIPTION from "./batch.txt"

const DISALLOWED = new Set(["batch"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])

const ToolCallSchema = Schema.Struct({
  tool: Schema.String.annotate({ description: "The name of the tool to execute" }),
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Any)).annotate({
    description: "Parameters for the tool",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Human-readable label for this call in session history",
  }),
})

export const Parameters = Schema.Struct({
  tool_calls: Schema.Array(ToolCallSchema).annotate({
    description: "Array of tool calls to execute in parallel",
  }),
})

type BatchedCall = Schema.Schema.Type<typeof ToolCallSchema>
type ExecuteArgs = Schema.Schema.Type<typeof Parameters>

export const BatchTool = Tool.define(
  "batch",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      formatValidationError(error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        return `Invalid parameters for tool 'batch': ${msg}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
      },
      execute: (args: ExecuteArgs, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const calls = args.tool_calls.slice(0, 25)
          const discarded = args.tool_calls.slice(25)

          const opt = yield* Effect.serviceOption(RegistryService)
          if (Option.isNone(opt)) {
            throw new Error("Tool registry not available")
          }
          const registry = opt.value
          const available = yield* registry.all()
          const map = new Map(available.map((t: Tool.Def) => [t.id, t]))

          const executeCall = (call: BatchedCall) =>
            Effect.gen(function* () {
              const start = Date.now()
              const pid = PartID.ascending()

              if (DISALLOWED.has(call.tool)) {
                const err = `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`
                yield* session.updatePart({
                  id: pid,
                  messageID: ctx.messageID,
                  sessionID: ctx.sessionID,
                  type: "tool" as const,
                  tool: call.tool,
                  callID: pid,
                  metadata: call.description ? { description: call.description } : undefined,
                  state: {
                    status: "error" as const,
                    input: call.parameters ?? {},
                    error: err,
                    time: { start, end: Date.now() },
                  },
                } ) 
                return { success: false as const, tool: call.tool, error: err }
              }

              const tool = map.get(call.tool)
              if (!tool) {
                const names = Array.from(map.keys()).filter((n) => !FILTERED_FROM_SUGGESTIONS.has(n))
                const err = `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${names.join(", ")}`
                yield* session.updatePart({
                  id: pid,
                  messageID: ctx.messageID,
                  sessionID: ctx.sessionID,
                  type: "tool" as const,
                  tool: call.tool,
                  callID: pid,
                  metadata: call.description ? { description: call.description } : undefined,
                  state: {
                    status: "error" as const,
                    input: call.parameters ?? {},
                    error: err,
                    time: { start, end: Date.now() },
                  },
                } ) 
                return { success: false as const, tool: call.tool, error: err }
              }

              yield* session.updatePart({
                id: pid,
                messageID: ctx.messageID,
                sessionID: ctx.sessionID,
                type: "tool" as const,
                tool: call.tool,
                callID: pid,
                state: {
                  status: "running" as const,
                  input: call.parameters ?? {},
                  time: { start },
                },
              } ) 

              try {
                const result = yield* tool.execute(call.parameters ?? {}, { ...ctx, callID: pid })
                const attachments = result.attachments?.map((a: any) => ({
                  ...a,
                  id: PartID.ascending(),
                  sessionID: ctx.sessionID,
                  messageID: ctx.messageID,
                }))

                yield* session.updatePart({
                  id: pid,
                  messageID: ctx.messageID,
                  sessionID: ctx.sessionID,
                  type: "tool" as const,
                  tool: call.tool,
                  callID: pid,
                  metadata: call.description ? { description: call.description } : undefined,
                  state: {
                    status: "completed" as const,
                    input: call.parameters ?? {},
                    output: result.output,
                    title: result.title,
                    metadata: result.metadata,
                    attachments,
                    time: { start, end: Date.now() },
                  },
                } ) 

                return { success: true as const, tool: call.tool, result }
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                yield* session.updatePart({
                  id: pid,
                  messageID: ctx.messageID,
                  sessionID: ctx.sessionID,
                  type: "tool" as const,
                  tool: call.tool,
                  callID: pid,
                  metadata: call.description ? { description: call.description } : undefined,
                  state: {
                    status: "error" as const,
                    input: call.parameters ?? {},
                    error: msg,
                    time: { start, end: Date.now() },
                  },
                } ) 

                return { success: false as const, tool: call.tool, error: msg }
              }
            })

          const results = yield* Effect.all(calls.map((c) => executeCall(c)), {
            concurrency: "unbounded",
          })

          const now = Date.now()
          for (const call of discarded) {
            const pid = PartID.ascending()
            yield* session.updatePart({
              id: pid,
              messageID: ctx.messageID,
              sessionID: ctx.sessionID,
              type: "tool" as const,
              tool: call.tool,
              callID: pid,
              state: {
                status: "error" as const,
                input: call.parameters ?? {},
                error: "Maximum of 25 tools allowed in batch",
                time: { start: now, end: now },
              },
            } ) 
            results.push({
              success: false as const,
              tool: call.tool,
              error: "Maximum of 25 tools allowed in batch",
            })
          }

          const ok = results.filter((r: any) => r.success).length
          const fail = results.length - ok

          const output =
            fail > 0
              ? `Executed ${ok}/${results.length} tools successfully. ${fail} failed.`
              : `All ${ok} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

          return {
            title: `Batch execution (${ok}/${results.length} successful)`,
            output,
            attachments: results
              .filter((r: any) => r.success && r.result)
              .flatMap((r: any) => r.result.attachments ?? []),
            metadata: {
              totalCalls: results.length,
              successful: ok,
              failed: fail,
              tools: args.tool_calls.map((c) => c.tool),
              details: results.map((r) => ({ tool: r.tool, success: r.success })),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
