import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, Show, untrack } from "solid-js"
import { Token } from "@/util/token"

const id = "internal:sidebar-context"
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return Math.round(n / 1_000) + "k"
  return n.toLocaleString()
}

function money4(n: number): string {
  if (n < 0.01) return "$" + n.toFixed(4)
  if (n < 1) return "$" + n.toFixed(3)
  return money.format(n)
}

function cacheColor(r: number): string {
  return "#" + Math.round(255 * (1 - r / 100)).toString(16).padStart(2, "0")
    + Math.round(255 * (r / 100)).toString(16).padStart(2, "0") + "00"
}

function ctx(v: string, l: string): string { return v.padStart(8) + " " + l.padEnd(9) }
function use(l: string, v: string): string { return l.padEnd(6) + " " + v.padStart(10) }

function View(p: { api: TuiPluginApi; session_id: string }) {
  const t = () => p.api.theme.current
  const msgs = createMemo(() => p.api.state.session.messages(p.session_id))
  const providers = createMemo(() => p.api.state.provider)

  const last = createMemo(() =>
    msgs().findLast((m): m is AssistantMessage => m.role === "assistant" && m.finish !== undefined),
  )

  const model = createMemo(() => {
    const l = last()
    if (!l) return
    return providers().find((i) => i.id === l.providerID)?.models[l.modelID]
  })

  const turn = createMemo(() => {
    const l = last()
    if (!l || !model()) return
    const m = model()!
    const total = l.tokens.input + l.tokens.output + l.tokens.reasoning + l.tokens.cache.read + l.tokens.cache.write
    return {
      tok: fmt(total),
      pct: Math.round((total / m.limit.context) * 100),
      cached: l.tokens.cache.read + l.tokens.cache.write,
      cacheRead: l.tokens.cache.read,
      input: l.tokens.input,
      output: l.tokens.output + l.tokens.reasoning,
      cost: l.cost,
    }
  })

  const session = createMemo(() => p.api.state.session.get(p.session_id))

  const ses = createMemo(() => {
    const s = session()
    const all = msgs()
    let seams = 0
    for (const m of all) {
      if (m.role === "assistant" && (m as any).mode === "seam") seams++
    }
    const tokens = s?.tokens
    return {
      cached: (tokens?.cache?.read ?? 0) + (tokens?.cache?.write ?? 0),
      input: tokens?.input ?? 0,
      output: (tokens?.output ?? 0) + (tokens?.reasoning ?? 0),
      cost: s?.cost ?? 0,
      seams,
    }
  })

  const seamLimit = Number(process.env["OPENCODE_SEAM_BLOCK_SIZE"]) || 200_000

  const seamBpe = createMemo(() => {
    last()
    const all = msgs()
    if (!all.length) return 0
    let b = 0
    for (let i = all.length - 1; i >= 0; i--) {
      const msg = all[i]
      if (msg.role === "assistant" && ((msg as any).mode === "seam" || (msg as any).summary)) break
      const parts = untrack(() => p.api.state.part((msg as any).id) || [])
      for (const p of parts as any[]) {
        if (p.text) b += Token.estimate(p.text)
        if (p.type === "tool") {
          if (p.state?.output) b += Token.estimate(String(p.state.output))
          if (p.state?.input) b += Token.estimate(JSON.stringify(p.state.input))
        }
      }
      if (b >= seamLimit) break
    }
    return b
  })

  return (
    <box flexDirection="row" justifyContent="space-between">
      <box>
        <text fg={t().text}><b>{"Context".padEnd(18)}</b></text>
        <Show when={ses()}>{(s) =>
          <text fg={t().textMuted}>{ctx(money.format(s().cost), "spent")}</text>
        }</Show>
        <Show when={turn()}>{(tu) =>
          <text fg={t().textMuted}>{ctx(tu().tok, "tok.(" + tu().pct + "%)")}</text>
        }</Show>
        <Show when={ses()}>{(s) => <>
          <text fg={t().textMuted}>{ctx(fmt(s().cached), "ses.")}</text>
          <text fg={t().textMuted}>{ctx(fmt(s().input), "(" + (s().cached ? Math.round(s().input / s().cached * 1000) / 10 + "%" : "0.0%") + ")")}</text>
          <text fg={t().textMuted}>{ctx(fmt(s().output), "(" + (s().cached ? Math.round(s().output / s().cached * 1000) / 10 + "%" : "0.0%") + ")")}</text>
          {s().seams > 0 ? <text fg={t().text}>{ctx(String(s().seams), "seam" + (s().seams > 1 ? "s" : ""))}</text> : undefined}
        </>}</Show>
      </box>
      <box>
        <text fg={t().text}><b>{"Usage".padEnd(17)}</b></text>
        <Show when={turn()}>{(tu) => {
          const r = () => {
            const cr = tu().cacheRead
            const ci = tu().input
            return Math.round(cr / Math.max(1, cr + ci) * 100)
          }
          return <>
            <text fg={t().textMuted}>{use("turn", money4(tu().cost))}</text>
            <text fg={t().textMuted}>{"seam".padEnd(7) + (fmt(Math.min(seamBpe(), seamLimit)) + " / " + fmt(seamLimit)).padStart(10)}</text>
            <box flexDirection="row">
              <text fg={t().textMuted}>{"cached "}</text>
              <text fg={cacheColor(r())}>{String(r()).padStart(3)}%{" "}</text>
              <text fg={t().textMuted}>{fmt(tu().cached).padStart(5)}</text>
            </box>
            <text fg={t().textMuted}>{use("input", fmt(tu().input))}</text>
            <text fg={t().textMuted}>{use("output", fmt(tu().output))}</text>
          </>
        }}</Show>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: { sidebar_content(_ctx, props) { return <View api={api} session_id={props.session_id} /> } },
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }

export default plugin
