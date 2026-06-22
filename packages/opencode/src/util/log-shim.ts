// Minimal log shim replacing the deleted @opencode-ai/core/util/log
const noop = () => {}
const logger = {
  info: noop,
  error: noop,
  warn: noop,
  clone: () => logger,
  tag: () => logger,
  with: () => logger,
  time: () => ({ [Symbol.dispose]: noop }),
}
export const Log = {
  create: () => logger,
}
