/** @jsxImportSource @opentui/solid */
import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"
import path from "path"

export interface FileLinkProps {
  file: string
  directory?: string
  children?: JSX.Element | string
  fg?: RGBA
  bg?: RGBA
  width?: number | "auto" | `${number}%`
  wrapMode?: "word" | "none"
}

export function FileLink(props: FileLinkProps) {
  const absolute = path.isAbsolute(props.file) ? props.file : props.directory ? path.join(props.directory, props.file) : props.file
  const displayText = typeof props.children === "string" ? props.children : props.file

  return (
    <text
      fg={props.fg}
      bg={props.bg}
      width={props.width}
      wrapMode={props.wrapMode}
      onMouseUp={() => {
        open("file://" + absolute).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
