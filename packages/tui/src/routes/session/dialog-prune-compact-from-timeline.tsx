import { createMemo, onMount, type JSX } from "solid-js"
import { useSync } from "../../context/sync"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { Locale } from "../../util/locale"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { useToast } from "../../ui/toast"
import { useDialog, type DialogContext } from "../../ui/dialog"

// Picks where /prunecompact cuts. The default keeps today's behaviour (prune
// everything before the last user message); choosing a seam moves the boundary to
// that seam, so the seam summary and everything after it survive verbatim.
export function DialogPruneCompactFromTimeline(props: { sessionID: string; onMove: (messageID?: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const toast = useToast()

  onMount(() => {
    dialog.setSize("large")
  })

  async function prune(messageID: string | undefined, close: DialogContext) {
    const result = await sdk.client.session.pruneCompact({
      sessionID: props.sessionID,
      ...(messageID ? { messageID } : {}),
    })
    if (!result.data?.id) {
      toast.show({ message: "Failed to prune session", variant: "error" })
      return
    }
    route.navigate({ sessionID: result.data.id, type: "session" })
    close.clear()
    toast.show({ message: "Created pruned session", variant: "success" })
  }

  const options = createMemo((): DialogSelectOption<string | undefined>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const seams = [] as DialogSelectOption<string | undefined>[]
    for (const message of messages) {
      if (message.role !== "assistant" || message.mode !== "seam") continue
      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((x) => x.type === "text" && !x.synthetic && !x.ignored)
      const firstLine =
        textPart && textPart.type === "text" ? textPart.text.replace(/\n/g, " ").slice(0, 120) : ""
      seams.push({
        title: firstLine || `Seam #${seams.length + 1}`,
        value: message.id,
        footer: (
          <span>
            {Locale.time(message.time.created)}
            {firstLine ? ` — ${firstLine}` : ""}
          </span>
        ) as JSX.Element,
        onSelect: async (close: DialogContext) => prune(message.id, close),
      })
    }
    return [
      {
        title: "Last user message",
        value: undefined,
        footer: "Prune everything before the last user message",
        onSelect: async (close: DialogContext) => prune(undefined, close),
      },
      ...seams.reverse(),
    ]
  })

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Prune-compact session" options={options()} />
}
