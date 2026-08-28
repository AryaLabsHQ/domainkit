import { Effect } from "effect";

import * as ProviderAuthorization from "../auth/authorization.ts";

export { Capability, encode, Schema } from "../auth/authorization.ts";
export type { ProviderAuthorization } from "../auth/authorization.ts";

export function decode(input: unknown): Promise<ProviderAuthorization.ProviderAuthorization> {
  return Effect.runPromise(ProviderAuthorization.decode(input));
}
