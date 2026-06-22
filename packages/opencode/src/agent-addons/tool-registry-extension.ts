import { Flag } from "@opencode-ai/core/flag/flag"
import { descriptions as descs } from "@/agent-addons/tool-descriptions"

export const gated = Flag.OPENCODE_AGENT_EXTENSIONS

export function dsdesc(id: string, fallback: string, modelID: string): string {
  if (!gated) return fallback
  if (!modelID.toLowerCase().includes("deepseek")) return fallback
  return (descs as Record<string, string>)[id] ?? fallback
}
