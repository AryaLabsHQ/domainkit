import { Clock, Crypto, Effect } from "effect";

import { CryptoError, CryptoError as CryptoFailure } from "../plan/canonical-json.ts";
import type { Error as InvalidInputError } from "../invalid-input.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import type * as Storage from "../stores/error.ts";
import type * as Connection from "./connection.ts";
import type * as ProviderAuth from "./manifest.ts";
import { Value as Secret } from "./secret.ts";

export interface Input {
  readonly grant: Connection.Grant;
  readonly providerId: string;
  readonly subjectId: string;
  readonly token: Secret;
  readonly validate: (
    token: Secret,
  ) => Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error | InvalidInputError>;
}

export const connect = Effect.fn("TokenConnection.connect")(function* (input: Input) {
  const connectionStore = yield* ConnectionStore.Service;
  const credentialStore = yield* CredentialStore.Service;
  const cryptoService = yield* Crypto.Crypto;
  const validation = yield* input.validate(input.token);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const id = yield* cryptoService.randomUUIDv4.pipe(
    Effect.mapError((cause) => new CryptoFailure({ message: cause.message })),
  );
  const connection: Connection.Connection = {
    accountId: validation.accountId,
    capabilities: [...validation.capabilities],
    createdAt,
    expiresAt: validation.expiresAt,
    grant: input.grant,
    id,
    kind: "token",
    providerId: input.providerId,
    scopes: [...validation.scopes],
    subjectId: input.subjectId,
  };
  yield* credentialStore.put(connection.id, {
    accessToken: input.token,
    refreshToken: null,
    tokenType: "bearer",
  });
  yield* connectionStore.put(connection);
  return connection;
});

export type Error = DnsProvider.Error | InvalidInputError | CryptoError | Storage.Error;

export type Requirements = ConnectionStore.Service | CredentialStore.Service | Crypto.Crypto;
