import { Clock, Effect } from "effect";

import { CryptoError } from "../plan/canonical-json.ts";
import type { Error as InvalidInputError } from "../invalid-input.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as ProviderAuthorization from "./authorization.ts";
import * as Connect from "./connect.ts";
import type * as ProviderAuth from "./manifest.ts";
import { Value as Secret } from "./secret.ts";

export interface Input {
  readonly authorizedById: string;
  readonly authorizationId?: string;
  readonly ownerId: string;
  readonly providerId: string;
  readonly token: Secret;
  readonly validate: (
    token: Secret,
  ) => Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error | InvalidInputError>;
}

/** Authenticate a token and persist an organization connection through the cohesive lifecycle. */
export const connect = Effect.fn("TokenConnection.connect")(function* (input: Input) {
  const validation = yield* input.validate(input.token);
  const observedAt = new Date(yield* Clock.currentTimeMillis);
  const requiredCapabilities = [...validation.capabilities];
  const method = Connect.Method.Token({
    authenticate: () =>
      Effect.succeed({
        capabilityEvidence: validation.capabilities.map((capability) => ({
          capability,
          evidence: ProviderAuthorization.Evidence.Introspected({ observedAt }),
        })),
        credential: { accessToken: input.token, refreshToken: null, tokenType: "bearer" },
        expiresAt: validation.expiresAt,
        providerAccountId: validation.accountId,
        providerContext: { value: {}, version: `${input.providerId}.v1` },
        scopes: [...validation.scopes],
      } satisfies Connect.Authentication),
    providerId: input.providerId,
    requiredCapabilities,
    token: input.token,
  });
  const result = yield* Connect.start({
    authorizedById: input.authorizedById,
    ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId }),
    method,
    ownerId: input.ownerId,
  });
  if (result._tag === "Redirect") {
    return yield* new Connect.Error({
      category: "validation",
      message: "Token authentication unexpectedly returned a redirect",
      operation: "TokenConnection.connect",
      retry: "never",
    });
  }
  return result.connection;
});

export type Error = DnsProvider.Error | InvalidInputError | Connect.Error | CryptoError;

export type Requirements = Connect.Requirements;
