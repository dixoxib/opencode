// Shared TTS state. Read by the per-part controls (core TextPart/ReasoningPart)
// and written by the ctrl+P toggle and the engine. Module-level signals are the
// simplest channel every side can reach; they live for the app's lifetime.
import { createSignal } from "solid-js"

export type TtsMode = "auto" | "manual"

// "manual" is the safe default: nothing speaks until the user clicks a part.
const [ttsMode, setTtsMode] = createSignal<TtsMode>("manual")

// Identifies what is currently being spoken (e.g. "part:<id>", "turn:<id>",
// "auto:<sessionID>"), or undefined when silent. Lets the UI show a stop/active
// affordance on the matching control.
const [speakingKey, setSpeakingKey] = createSignal<string | undefined>(undefined)

export const isSpeaking = () => speakingKey() !== undefined

export { ttsMode, setTtsMode, speakingKey, setSpeakingKey }
