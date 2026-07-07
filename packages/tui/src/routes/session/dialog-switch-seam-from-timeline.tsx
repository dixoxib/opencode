import { createMemo, onMount, type JSX } from "solid-js"
import { useSync } from "../../context/sync"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { Locale } from "../../util/locale"
import { useSDK } from "../../context/sdk"
import { useDialog, type DialogContext } from "../../ui/dialog"

export function DialogSwitchSeamFromTimeline(props: {
  sessionID: string
  onMove: (messageID?: string) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as DialogSelectOption<string>[]
    for (const message of messages) {
      if (message.role !== "assistant") continue
      if (message.mode !== "seam") continue
      // Find the seam's summary text (the first text part after mode:seam)
      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find(
        (x) => x.type === "text" && !x.synthetic && !x.ignored,
      )
      let firstLine = textPart
        ? (textPart as unknown as { text: string }).text.replace(/\n/g, " ").slice(0, 120)
        : ""
      if (firstLine.length === 120) firstLine += "…"
      const footer = (
        <span>
          {Locale.time(message.time.created)}
          {firstLine ? ` — ${firstLine}` : ""}
        </span>
      ) as JSX.Element
      result.push({
        title: firstLine || `Seam #${result.length + 1}`,
        value: message.id,
        footer,
        onSelect: async (dialog: DialogContext) => {
          await sdk.client.session.switchSeam({
            sessionID: props.sessionID,
            messageID: message.id,
          })
          dialog.clear()
        },
      })
    }
    return result.reverse()
  })

  return (
    <DialogSelect
      onMove={(option) => props.onMove(option.value)}
      title="Switch seam to compaction"
      options={options()}
    />
  )
}
