import { Clock, Crypto, Effect } from "effect";

import type { CryptoError, ProviderError, StorageError } from "../errors.ts";
import { CryptoError as CryptoFailure } from "../errors.ts";
import {
  ConnectionStore,
  type ConnectionStoreService,
  CredentialStore,
  type CredentialStoreService,
} from "../stores/contracts.ts";
import { Secret } from "./secret.ts";
import type { Connection, ConnectionGrant, TokenValidation } from "./types.ts";

export interface ConnectTokenInput {
  readonly grant: ConnectionGrant;
  readonly providerId: string;
  readonly subjectId: string;
  readonly token: Secret;
  readonly validate: (
    token: Secret,
  ) => Effect.Effect<
    TokenValidation,
    ProviderError | import("../invalid-input-error.ts").InvalidInputError
  >;
}

export function connectToken(
  input: ConnectTokenInput,
): Effect.Effect<
  Connection,
  | ProviderError
  | import("../invalid-input-error.ts").InvalidInputError
  | CryptoError
  | StorageError,
  ConnectionStoreService | CredentialStoreService | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const connectionStore = yield* ConnectionStore;
    const credentialStore = yield* CredentialStore;
    const cryptoService = yield* Crypto.Crypto;
    const validation = yield* input.validate(input.token);
    const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const id = yield* cryptoService.randomUUIDv4.pipe(
      Effect.mapError((cause) => new CryptoFailure({ message: cause.message })),
    );
    const connection: Connection = {
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
}
