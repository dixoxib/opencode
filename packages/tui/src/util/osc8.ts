import path from "path"

export function osc8FileLink(file: string, directory?: string): string {
  if (!directory) return file
  const absolute = path.isAbsolute(file) ? file : path.join(directory, file)
  return `\x1b]8;;file://${absolute}\x1b\\${file}\x1b]8;;\x1b\\`
}
