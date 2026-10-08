// Clickable speak controls rendered around each assistant text/reasoning part.
// Layout per confirmed spec:
//   - above the FIRST part of a turn: "⏵⏵ turn" (whole turn)
//   - below every part: "⏵ part" (this part) + "⏵⏵ ab hier" (the rest after this
//     part); below the LAST part the rest-button becomes "⏵⏵ turn" (whole turn).
// A turn spans all assistant messages sharing the same parentID (tool loops).
// A click opens a live scope (see ./live) instead of a one-shot snapshot, so the
// part keeps being spoken as the stream fills it, and only that part.
// Hover brightens a button (Read-tool pattern); text selection suppresses the
// click so selecting doesn't start playback.
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import type { AssistantMessage, ReasoningPart, TextPart } from "@opencode-ai/sdk/v2"
import { useRenderer } from "@opentui/solid"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { speakingKey } from "./state"
import { startLive, stopLive, turnParts, type SpeechPart, type TurnReader } from "./live"

type SpeakPart = TextPart | ReasoningPart
type SpeakScope = Parameters<typeof startLive>[0]

function SpeakButton(props: { label: string; scope: () => SpeakScope }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const active = () => speakingKey() === props.scope().key
  return (
    <box
      marginRight={2}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return // don't hijack text selection
        if (active()) return stopLive()
        startLive(props.scope())
      }}
    >
      <text fg={active() || hover() ? theme.text : theme.textMuted}>{active() ? `■ ${props.label}` : props.label}</text>
    </box>
  )
}

export function TtsPartControls(props: { part: SpeakPart; message: AssistantMessage; place: "above" | "below" }) {
  const sync = useSync()

  // Ordered speakable parts of the whole turn: every assistant message that
  // shares this message's parentID, text + reasoning parts in order.
  const reader: TurnReader = {
    messages: (sessionID) => sync.data.message[sessionID] ?? [],
    parts: (messageID) =>
      (sync.data.part[messageID] ?? []).flatMap((part) =>
        part.type === "text" || part.type === "reasoning" ? [{ id: part.id, type: part.type, text: part.text }] : [],
      ),
  }
  const turnPartsList = createMemo(() => turnParts(reader, props.message.sessionID, props.message.parentID))
  const index = createMemo(() => turnPartsList().findIndex((part) => part.id === props.part.id))
  const isLast = createMemo(() => index() === turnPartsList().length - 1)
  const turnKey = () => `turn:${props.message.parentID}`
  const self = (): SpeechPart => ({ id: props.part.id, type: props.part.type, text: props.part.text })

  return (
    <Switch>
      <Match when={props.place === "above"}>
        <Show when={index() === 0}>
          <box paddingLeft={3} flexDirection="row" marginTop={1}>
            <SpeakButton
              label="⏵⏵ turn"
              scope={() => ({
                kind: "turn",
                key: turnKey(),
                sessionID: props.message.sessionID,
                parentID: props.message.parentID,
                parts: turnPartsList(),
              })}
            />
          </box>
        </Show>
      </Match>
      <Match when={props.place === "below"}>
        <box paddingLeft={3} flexDirection="row">
          <SpeakButton
            label="⏵ part"
            scope={() => ({
              kind: "part",
              key: `part:${props.part.id}`,
              sessionID: props.message.sessionID,
              parentID: props.message.parentID,
              anchor: props.part.id,
              parts: [self()],
            })}
          />
          <SpeakButton
            label={isLast() ? "⏵⏵ turn" : "⏵⏵ ab hier"}
            scope={() =>
              isLast()
                ? {
                    kind: "turn",
                    key: turnKey(),
                    sessionID: props.message.sessionID,
                    parentID: props.message.parentID,
                    parts: turnPartsList(),
                  }
                : {
                    kind: "after",
                    key: `after:${props.part.id}`,
                    sessionID: props.message.sessionID,
                    parentID: props.message.parentID,
                    anchor: props.part.id,
                    parts: turnPartsList().slice(index() + 1),
                  }
            }
          />
        </box>
      </Match>
    </Switch>
  )
}
