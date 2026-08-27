import { Effect } from "effect";

import * as ProviderAuth from "../auth/manifest.ts";

export { Method, Schema } from "../auth/manifest.ts";
export type {
  AsyncOAuthSubjectResolver as OAuthSubjectResolver,
  Manifest,
  OAuthClientConfiguration,
  OAuthMethod,
  TokenValidation,
} from "../auth/manifest.ts";

export function decode(input: unknown): Promise<ProviderAuth.Manifest> {
  return Effect.runPromise(ProviderAuth.decode(input));
}
