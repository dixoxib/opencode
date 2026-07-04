import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260604000000_tokens_since_seam",
  up(tx) {
    return Effect.gen(function* () {
      // Defensive: the column may already exist on databases that ran an earlier
      // form of this migration out-of-band. SQLite has no ADD COLUMN IF NOT EXISTS,
      // so probe table_info first to avoid a duplicate-column failure.
      if (
        (yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session\`)`)).some(
          (column) => column.name === "tokens_since_seam",
        )
      )
        return
      yield* tx.run(`ALTER TABLE \`session\` ADD \`tokens_since_seam\` integer DEFAULT 0 NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
