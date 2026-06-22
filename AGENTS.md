- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Commits and PR Titles

Conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Logic stays in one function unless composable or reusable.
- Single-use helpers stay inline at the call site. Extraction makes sense when the helper is reused, hides a genuinely complex boundary, or names a clear concept that improves the caller.
- `try`/`catch` is avoided.
- The `any` type is avoided.
- Bun APIs are preferred when possible, like `Bun.file()`.
- Type inference carries the weight; explicit type annotations or interfaces appear only for exports or clarity.
- Functional array methods (flatMap, filter, map) are preferred over for loops; type guards on filter maintain type inference downstream.
- In `src/config`, the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) is followed when adding a new config module.

Total variable count stays low — values used once are inlined.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Destructuring is avoided when dot notation preserves context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Imports are not aliased. Renamed imports like `resolve as pathResolve` are not used.
- Star imports (`import * as Foo from "..."` or `import type * as Foo from "..."`) are not used.
- When a namespace-style value is needed, the module's own exported namespace is imported by name, for example `import { Project } from "@opencode-ai/core/project"`, then referenced as `Project.ID`.
- Dynamic imports are preferred for heavy modules needed only in selected code paths, especially in startup-sensitive entrypoints. Dynamic import bindings are destructured near the top of the narrowest scope that needs them so they read like normal imports. Inline chains like `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()` are avoided. Branch-specific imports stay inside the branch that needs them to preserve lazy loading.

### Variables

`const` is preferred over `let`. Ternaries or early returns replace reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

`else` is avoided; early returns are preferred.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, the main function reads as the happy path and supporting details move into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Helpers stay close to the code they support, below the main export when that improves readability.
- Simple expressions are not over-abstracted into many single-use helpers; extraction is used only when it names a real concept like `requireConfig` or `readMetadata`.
- Helpers that perform effectful work return `Effect`; synchronous parsing, validation, and option building stay synchronous.
- Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` are preferred over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Comments document non-obvious constraints and surprising behavior, not obvious assignments or control flow.

### Schema Definitions (Drizzle)

Snake_case is used for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Mocks are avoided as much as possible.
- Tests exercise the actual implementation, not duplicated logic.
- Tests run from package directories like `packages/opencode`, never from repo root (guard: `do-not-run-tests-from-root`).

## Type Checking

`bun typecheck` is run from package directories (e.g., `packages/opencode`), not `tsc` directly.
