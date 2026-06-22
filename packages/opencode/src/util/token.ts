import { estimate as bpeEstimate, PER_TURN_OVERHEAD } from "@/agent-addons/util/token-deepseek"

export const estimate = bpeEstimate
export { PER_TURN_OVERHEAD }
export const Token = { estimate, PER_TURN_OVERHEAD }
