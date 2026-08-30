import { Effect } from "effect";

import * as DnsPlan from "../plan/types.ts";

export { Authorization, encode, encodeReceipt, Operation, Receipt, Schema } from "../plan/types.ts";
export type { ApplyReceipt, DnsPlan, PlanAuthorization } from "../plan/types.ts";

export function decode(input: unknown): Promise<DnsPlan.DnsPlan> {
  return Effect.runPromise(DnsPlan.decode(input));
}

export function decodeReceipt(input: unknown): Promise<DnsPlan.ApplyReceipt> {
  return Effect.runPromise(DnsPlan.decodeReceipt(input));
}
