import { Clock, Crypto, Effect } from "effect";

import { CryptoError, CryptoError as CryptoFailure } from "../plan/canonical-json.ts";
import type { Error as InvalidInputError } from "../invalid-input.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import * as ProviderAuthorizationStore from "../stores/authorization.ts";
import type * as Storage from "../stores/error.ts";
import * as Connection from "./connection.ts";
import * as ProviderAuthorization from "./authorization.ts";
import type * as ProviderAuth from "./manifest.ts";
import { Value as Secret } from "./secret.ts";

export interface Input {
  readonly grant: Connection.Grant;
  readonly ownerId: string;
  readonly providerId: string;
  readonly subjectId: string;
  readonly token: Secret;
  readonly validate: (
    token: Secret,
  ) => Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error | InvalidInputError>;
}

export const connect = Effect.fn("TokenConnection.connect")(function* (input: Input) {
  const authorizationStore = yield* ProviderAuthorizationStore.Service;
  const connectionStore = yield* ConnectionStore.Service;
  const credentialStore = yield* CredentialStore.Service;
  const cryptoService = yield* Crypto.Crypto;
  const validation = yield* input.validate(input.token);
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const existingAuthorization = yield* authorizationStore.findByProviderAccount(
    input.providerId,
    validation.accountId,
  );
  const authorization = yield* ProviderAuthorization.validate({
    accountId: validation.accountId,
    capabilities: [...validation.capabilities],
    createdAt: existingAuthorization?.createdAt ?? createdAt,
    expiresAt: validation.expiresAt,
    id:
      existingAuthorization?.id ??
      (yield* cryptoService.randomUUIDv4.pipe(
        Effect.mapError((cause) => new CryptoFailure({ message: cause.message })),
      )),
    kind: "token",
    providerId: input.providerId,
    scopes: [...validation.scopes],
    subjectId: input.subjectId,
  });
  const existingConnection = yield* connectionStore.find(input.ownerId, authorization.id);
  const connection = yield* Connection.validate({
    authorizationId: authorization.id,
    createdAt: existingConnection?.createdAt ?? createdAt,
    grant: input.grant,
    id:
      existingConnection?.id ??
      (yield* cryptoService.randomUUIDv4.pipe(
        Effect.mapError((cause) => new CryptoFailure({ message: cause.message })),
      )),
    ownerId: input.ownerId,
  });
  yield* credentialStore.put(authorization.id, {
    accessToken: input.token,
    refreshToken: null,
    tokenType: "bearer",
  });
  yield* authorizationStore.put(authorization);
  yield* connectionStore.put(connection);
  return { authorization, connection };
});

export type Error = DnsProvider.Error | InvalidInputError | CryptoError | Storage.Error;

export type Requirements =
  | ProviderAuthorizationStore.Service
  | ConnectionStore.Service
  | CredentialStore.Service
  | Crypto.Crypto;
