import { Effect } from "effect";

import * as Connection from "../auth/connection.ts";

export { assertGrant, AuthorizationError, encode, Grant, Schema } from "../auth/connection.ts";
export type { Connection, OAuthContinuation, StoredCredential } from "../auth/connection.ts";

export function decode(input: unknown): Promise<Connection.Connection> {
  return Effect.runPromise(Connection.decode(input));
}
