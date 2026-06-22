import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  filePath: Schema.optional(Schema.String).annotate({ description: "The absolute or relative path to the file to modify (fallback if edit has no own filePath)" }),
  edits: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        filePath: Schema.optional(Schema.String).annotate({ description: "The absolute or relative path to the file to modify (overrides top-level filePath)" }),
        oldString: Schema.String.annotate({ description: "The text to replace" }),
        newString: Schema.String.annotate({
          description: "The text to replace it with (must be different from oldString)",
        }),
        replaceAll: Schema.optional(Schema.Boolean).annotate({
          description: "Replace all occurrences of oldString (default false)",
        }),
      }),
    ),
  ).annotate({ description: "Array of edit operations to perform sequentially on the file" }),
})

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    const info = yield* EditTool
    const def = yield* Tool.init(info)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const out: string[] = []
          const files: any[] = []
          const results: any[] = []

          for (let i = 0; i < params.edits.length; i++) {
            const edit = params.edits[i]
            const label = `Edit ${i + 1}/${params.edits.length}`
            const file = edit.filePath || params.filePath
            if (!file) {
              out.push(`${label}: FAILED — no filePath (provide top-level or per-edit)`)
              results.push({ error: "missing filePath" })
              continue
            }

            const outcome = yield* Effect.exit(
              def.execute(
                {
                  filePath: file,
                  oldString: edit.oldString,
                  newString: edit.newString,
                  replaceAll: edit.replaceAll,
                },
                ctx,
              ),
            )

            if (outcome._tag === "Success") {
              const result = outcome.value
              results.push(result.metadata)
              if (result.metadata.filediff) {
                files.push(result.metadata.filediff)
              }
              out.push(`${label} (${path.relative(ins.worktree, file)}): ${result.output}`)
              yield* ctx.metadata({
                metadata: {
                  diff: result.metadata.diff,
                  filediff: result.metadata.filediff,
                },
              })
            } else {
              const cause = outcome.cause
              const msg = cause instanceof Error ? cause.message : String(cause)
              results.push({ error: msg })
              out.push(`${label} (${path.relative(ins.worktree, file)}): FAILED — ${msg}`)
            }
          }

          const uniqueFiles = [...new Set(files.map((f: any) => f.file))]
          const title = params.filePath
            ? path.relative(ins.worktree, params.filePath)
            : uniqueFiles.length === 1
              ? path.relative(ins.worktree, uniqueFiles[0])
              : files.length > 0
                ? `${files.length} files`
                : "multiedit"
          return {
            title: `${title} (multiedit)`,
            metadata: {
              files,
              results,
            },
            output: out.join("\n"),
          }
        }),
    }
  }),
)
