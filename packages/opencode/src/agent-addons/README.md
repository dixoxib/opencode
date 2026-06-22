# OpenCode Agent Addons

This directory contains custom extensions built by the DeepSeek agent to enhance OpenCode's token-counting accuracy, UI performance, context management, and DeepSeek-specific reasoning handling.

## Structure

- `auto-prune/` – Break-even pruning algorithm with tool-specific profiles, file grouping, and cooldown mechanics.
- `ui/` – SolidJS-based UI services (e.g., `context-metrics.tsx` for sidebar token metrics).
- `metrics/` – Token-estimation extensions:
  - `wrapper.ts` – Wrapper for `computeContextMetrics` that adds dynamic multiplier correction.
  - `context-manager/metrics.ts` – Context estimation with system prompt counting, tool-definition overhead, and performance logging.
- `tools/` – Additional tools beyond vanilla OpenCode (`context`, `prune`, `prune-suggest`).
- `tool-descriptions/` – DeepSeek-optimised short descriptions for key tools (multiedit, batch, bash, task).
- `provider/` – Provider-specific logic (`deepseek-transform.ts` – extracted DeepSeek reasoning-trace handling).
- `util/` – Utility extensions (`token-deepseek.ts` – tiktoken-based token counter; `tool-utils.ts` – shared tool helpers).
- `tokenizer/` – DeepSeek tokenizer data (`deepseek-tokenizer.json`, currently unused; `cl100k_base` via js-tiktoken is sufficient).

## Configuration

All extensions can be toggled via environment variables:

| Flag                                   | Default | Description                                                                                             |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `OPENCODE_AGENT_EXTENSIONS`            | `true`  | Master switch for all agent addons.                                                                     |
| `OPENCODE_AGENT_AUTO_PRUNE`            | `true`  | Enables break-even auto-pruning after each API call.                                                    |
| `OPENCODE_AGENT_MULTIPLIER_CORRECTION` | `true`  | Enables dynamic multiplier correction in token estimation.                                              |
| `OPENCODE_AGENT_REASONING_TOKENS`      | `true`  | Includes reasoning tokens in heuristic token estimates.                                                 |
| `OPENCODE_AGENT_DISABLE_SERIALIZATION` | `true`  | Disables expensive serialization-based token calculation in compaction.                                 |
| `OPENCODE_DEEPSEEK_REASONING`          | `true`  | Enables DeepSeek-specific reasoning-trace handling.                                                    |

Set any boolean flag to `"false"` or `"0"` to disable the corresponding feature.

## Integration Points

The addons hook into the original OpenCode code at these minimal points:

1. **`flag/flag.ts`** – Added the above flags; `OPENCODE_DISABLE_AUTOUPDATE` hardcoded to `true`.
2. **`provider/transform.ts`** – Conditional wrapper around `deepseekTransform`; falls back to no-op when extensions are disabled.
3. **`session/compaction.ts`** – Auto-prune integration (`autoPrune` + `resetPruneStats`), gated by `OPENCODE_AGENT_EXTENSIONS`.
4. **`tool/registry.ts`** – Conditional registration of custom tools; DeepSeek-description override for key tools.
5. **`tool/read.ts`** – Content-hash caching in `metadata.contentHash` for duplicate detection.
6. **`session/message-v2.ts`** – Added `compacted` field to `ToolPartState.Time` for pruned-tool placeholders.
7. **`session/prompt.ts`** – Prune call moved inside `runLoop` (after every API call, not just once per turn).
8. **`util/token.ts`** – `estimate()` delegates to agent-addons token counter; falls back to `chars/4` when extensions are disabled.
9. **`cli/cmd/tui/routes/session/index.tsx`** – `createContextMetrics` for sidebar; `MultiEdit` component for diff rendering.
10. **`provider/provider.ts`** – Request logging to `/tmp/opencode-request-debug.log` for debugging.

All other modifications are self-contained within this directory.

## Purpose

- **Separation of concerns** – Our custom code lives here, leaving the core OpenCode source as untouched as possible.
- **Easy upgrades** – Future OpenCode updates can be applied with minimal merge conflicts; only the integration points listed above need to be reviewed.
- **Configurability** – Each extension can be turned off individually, allowing fine-grained control over the agent's enhancements.

## Notes

- The addons are designed to be **optional**; when `OPENCODE_AGENT_EXTENSIONS=false`, all integration points fall back to vanilla OpenCode behaviour (no auto-pruning, no DeepSeek tool descriptions, char-based token counting).
- The multiplier correction relies on actual API token counts reported by the provider; it is only applied when such counts are available.
- The `deepseek-tokenizer.json` in `tokenizer/` is a full DeepSeek V4 tokenizer (~263k tokens in the vocabulary). It is not currently loaded at runtime because `cl100k_base` (via `js-tiktoken`) is within <1% accuracy for all practical purposes.
