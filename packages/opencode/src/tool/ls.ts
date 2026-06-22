import path from "path"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./ls.txt"
import * as Tool from "./tool"

const IGNORE = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

const LIMIT = 100

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "The absolute path to the directory to list (must be absolute, not relative)",
  }),
  ignore: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "List of glob patterns to ignore",
  }),
})

export const LsTool = Tool.define(
  "ls",
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

          const globs = IGNORE.map((p) => `!${p}`).concat((params.ignore ?? []).map((p) => `!${p}`))
          const files = yield* rg
            .files({ cwd: search, glob: globs, signal: ctx.abort })
            .pipe(Stream.take(LIMIT + 1), Stream.runCollect)
            .pipe(Effect.map((chunk) => [...chunk]))

          const truncated = files.length > LIMIT
          if (truncated) files.length = LIMIT

          const dirs = new Set<string>()
          const filesByDir = new Map<string, string[]>()

          for (const file of files) {
            const dir = path.dirname(file)
            const parts = dir === "." ? [] : dir.split("/")

            for (let i = 0; i <= parts.length; i++) {
              const dirPath = i === 0 ? "." : parts.slice(0, i).join("/")
              dirs.add(dirPath)
            }

            if (!filesByDir.has(dir)) filesByDir.set(dir, [])
            filesByDir.get(dir)!.push(path.basename(file))
          }

          function renderDir(dirPath: string, depth: number): string {
            const indent = "  ".repeat(depth)
            let output = ""

            if (depth > 0) {
              output += `${indent}${path.basename(dirPath)}/\n`
            }

            const childIndent = "  ".repeat(depth + 1)
            const children = Array.from(dirs)
              .filter((d) => path.dirname(d) === dirPath && d !== dirPath)
              .sort()

            for (const child of children) {
              output += renderDir(child, depth + 1)
            }

            const entries = filesByDir.get(dirPath) ?? []
            for (const file of entries.sort()) {
              output += `${childIndent}${file}\n`
            }

            return output
          }

          const output = `${search}/\n` + renderDir(".", 0)

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
