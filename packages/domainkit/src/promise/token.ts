import { Effect, Layer } from "effect";

import * as TokenEffect from "../auth/token.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as Lifecycle from "./managed-dns-connections.ts";
import type { Value as Secret } from "../auth/secret.ts";
import type * as ProviderAuth from "../auth/manifest.ts";

export function connect(input: {
  readonly authorizedById: string;
  readonly authorizationId?: string;
  readonly ownerId: string;
  readonly providerId: string;
  readonly repository: Lifecycle.AsyncInterface;
  readonly token: Secret;
  readonly validate: (token: Secret) => Promise<ProviderAuth.TokenValidation>;
}): Promise<import("../auth/connection.ts").ProviderConnection> {
  return Effect.runPromise(
    TokenEffect.connect({
      authorizedById: input.authorizedById,
      ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId }),
      ownerId: input.ownerId,
      providerId: input.providerId,
      token: input.token,
      validate: (token) =>
        Effect.tryPromise({
          try: () => input.validate(token),
          catch: (cause) =>
            cause instanceof InvalidInputError || cause instanceof DnsProvider.Error
              ? cause
              : new DnsProvider.Error({
                  cause,
                  message:
                    cause instanceof globalThis.Error ? cause.message : "Token validation failed",
                  operation: "validateToken",
                  providerId: input.providerId,
                }),
        }),
    }).pipe(
      Effect.provide(Layer.merge(Lifecycle.layerFromAsync(input.repository), webCryptoLayer)),
    ),
  );
}
