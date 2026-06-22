export * as ConfigSeam from "./seam"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Seam")({
  enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable context seaming (default: true)",
  }),
  block_size: PositiveInt.pipe(Schema.optional).annotate({
    description: "BPE token count at which an auto-seam is triggered (default 200000)",
  }),
  interval: PositiveInt.pipe(Schema.optional).annotate({
    description: "Number of assistant turns between seam checks (default 1 = every turn)",
  }),
  prune: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable pruning of tool outputs in older seam blocks (default: true)",
  }),
  prune_margin: PositiveInt.pipe(Schema.optional).annotate({
    description: "Token distance from current position before pruning older seam blocks (default: 50000)",
  }),
  prune_min_chars: PositiveInt.pipe(Schema.optional).annotate({
    description: "Minimum tool output length (chars) to trigger pruning (default: 1000)",
  }),
}) {}
