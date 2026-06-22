import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./ls.txt"
import * as Tool from "./tool"

const IGNORE = ["**/.git/**", "**/node_modules/**"]
const LIMIT = 1000

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to list. Defaults to the current working directory.",
  }),
  ignore: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Glob patterns to ignore. Uses gitignore syntax.",
  }),
})

export const LsTool = Tool.define(
  "ls",
// @ts-ignore
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const search = path.resolve(ins.directory, params.path ?? ".")
          yield* assertExternalDirectoryEffect(ctx, search, { kind: "directory" })

          yield* ctx.ask({
            permission: "list",
            patterns: [search],
            always: ["*"],
            metadata: { path: search },
          })

          const entries = yield* rg.find({
            cwd: search,
            pattern: params.ignore ? params.ignore.map((p: string) => `!${p}`).join(" ") : "",
            limit: LIMIT + 1,
            signal: ctx.abort,
          })

          const truncated = entries.length > LIMIT
          const files = truncated ? entries.slice(0, LIMIT) : entries

          const dirs = new Set<string>()
          const filesByDir = new Map<string, string[]>()

          for (const entry of files) {
            const dir = path.dirname(entry.path)
            if (!filesByDir.has(dir)) filesByDir.set(dir, [])
            filesByDir.get(dir)!.push(entry.path)
            let current = dir
            while (current !== search && current !== path.dirname(current)) {
              dirs.add(current)
              current = path.dirname(current)
            }
          }

          const output = [`Found ${entries.length} files${truncated ? ` (showing ${LIMIT})` : ""}`]
          for (const [dir, dirFiles] of filesByDir) {
            output.push(`  ${path.relative(search, dir) || "."}/`)
            for (const file of dirFiles) {
              output.push(`    ${path.basename(file)}`)
            }
          }

          return {
            title: `ls ${params.path || "."}`,
            output: output.join("\n"),
            metadata: { count: entries.length, truncated },
          }
        }),
    }
  }),
)
