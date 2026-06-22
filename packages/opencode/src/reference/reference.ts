import { Context, Layer } from "effect"

export interface Interface {}
export class Service extends Context.Service<Service, Interface>()("@opencode/Reference") {}
export const layer = Layer.succeed(Service, {})
export const defaultLayer = layer
export * as Reference from "./reference"
