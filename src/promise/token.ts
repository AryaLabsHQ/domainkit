import { Effect, Layer } from "effect";

import * as Connection from "../auth/connection.ts";
import * as ProviderAuthorization from "../auth/authorization.ts";
import type * as ProviderAuth from "../auth/manifest.ts";
import { Value as Secret } from "../auth/secret.ts";
import * as TokenEffect from "../auth/token.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import * as ProviderAuthorizationStore from "../stores/authorization.ts";

export function connect(input: {
  readonly connectionStore: ConnectionStore.AsyncInterface;
  readonly credentialStore: CredentialStore.AsyncInterface;
  readonly authorizationStore: ProviderAuthorizationStore.AsyncInterface;
  readonly grant: Connection.Grant;
  readonly ownerId: string;
  readonly providerId: string;
  readonly subjectId: string;
  readonly token: Secret;
  readonly validate: (token: Secret) => Promise<ProviderAuth.TokenValidation>;
}): Promise<{
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly connection: Connection.Connection;
}> {
  return Effect.runPromise(
    TokenEffect.connect({
      grant: input.grant,
      ownerId: input.ownerId,
      providerId: input.providerId,
      subjectId: input.subjectId,
      token: input.token,
      validate: (token) =>
        Effect.tryPromise({
          try: () => input.validate(token),
          catch: (cause) =>
            cause instanceof InvalidInputError || cause instanceof DnsProvider.Error
              ? cause
              : new DnsProvider.Error({
                  cause,
                  message: cause instanceof Error ? cause.message : "Token validation failed",
                  operation: "validateToken",
                  providerId: input.providerId,
                }),
        }),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ConnectionStore.layerFromAsync(input.connectionStore),
          ProviderAuthorizationStore.layerFromAsync(input.authorizationStore),
          CredentialStore.layerFromAsync(input.credentialStore),
          webCryptoLayer,
        ),
      ),
    ),
  );
}
