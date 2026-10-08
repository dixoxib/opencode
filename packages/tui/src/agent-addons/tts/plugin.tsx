// TTS feature-plugin: registers the ctrl+P palette toggle between auto/manual
// speech and, in auto mode, speaks each assistant text part as it arrives —
// keeping one live session open per turn so playback flows across parts without
// gaps. Reasoning is never spoken in auto mode (only on explicit manual click).
// The per-part clickable controls live in ./controls; both sides drive one live
// scope from ./live, so a manual click never bleeds into other parts and the
// session always closes when the turn goes idle.
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../../feature-plugins/builtins"
import { ttsMode, setTtsMode, type TtsMode } from "./state"
import { Tts } from "./engine"
import { currentScope, finishLive, speakTail, startAuto, stopLive, type TurnReader } from "./live"

const id = "internal:tts"
const autoKey = (sessionID: string) => `auto:${sessionID}`

const tui: TuiPlugin = async (api) => {
  const persisted = api.kv.get<TtsMode>("tts_mode", "manual")
  if (persisted === "auto" || persisted === "manual") setTtsMode(persisted)

  const reader: TurnReader = {
    messages: (sessionID) => api.state.session.messages(sessionID),
    parts: (messageID) =>
      api.state.part(messageID).flatMap((part) =>
        part.type === "text" || part.type === "reasoning" ? [{ id: part.id, type: part.type, text: part.text }] : [],
      ),
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "tts.toggle",
        title: "Toggle speech (auto/manual)",
        category: "System",
        namespace: "palette",
        run() {
          const next: TtsMode = ttsMode() === "auto" ? "manual" : "auto"
          setTtsMode(next)
          api.kv.set("tts_mode", next)
          if (next === "manual") stopLive()
          api.ui.toast({
            variant: "info",
            message:
              next === "auto" ? "Speech: auto (reads responses aloud)" : "Speech: manual (click a part to hear it)",
          })
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("tts.palette", ["tts.toggle"]),
  })

  api.event.on("message.part.updated", (event) => {
    const part = event.properties.part
    if (part.type !== "text" && part.type !== "reasoning") return
    if (api.state.session.get(part.sessionID)?.parentID) return // skip subagents
    if (currentScope()?.sessionID === part.sessionID) {
      speakTail(reader)
      return
    }
    if (ttsMode() !== "auto" || part.type !== "text") return
    const message = api.state.session.messages(part.sessionID).find((item) => item.id === part.messageID)
    if (message?.role !== "assistant" || !message.parentID) return
    startAuto({ key: autoKey(part.sessionID), sessionID: part.sessionID, parentID: message.parentID })
    speakTail(reader)
  })

  api.event.on("session.status", (event) => {
    if (event.properties.status.type !== "idle") return
    if (currentScope()?.sessionID !== event.properties.sessionID) return
    finishLive() // let the buffered tail play out
  })

  api.lifecycle.onDispose(() => Tts.stop())
}

const plugin: BuiltinTuiPlugin = { id, tui }

export default plugin
