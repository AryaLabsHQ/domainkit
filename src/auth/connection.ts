import { Effect, Schema as S } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import type { Value as Secret } from "./secret.ts";
import type { OAuthMethod } from "./manifest.ts";
import type * as ProviderAuthorization from "./authorization.ts";

export const Grant = S.TaggedUnion({
  account: {},
  domains: { domains: S.Array(DomainName.Schema) },
});
export type Grant = typeof Grant.Type;

/** An owner-scoped grant bound to one provider authorization. */
export const Schema = S.Struct({
  authorizationId: S.String,
  createdAt: S.DateFromString,
  grant: Grant,
  id: S.String,
  ownerId: S.String,
});
export interface Connection extends S.Schema.Type<typeof Schema> {}

export const decode = Effect.fn("Connection.decode")((input: unknown) =>
  S.decodeUnknownEffect(Schema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const validate = Effect.fn("Connection.validate")((input: unknown) =>
  S.decodeUnknownEffect(S.toType(Schema))(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const encode = S.encodeSync(Schema);

export interface OAuthContinuation {
  readonly clientId: string;
  readonly codeVerifier: Secret;
  readonly expiresAt: Date;
  readonly grant: Grant;
  readonly method: OAuthMethod;
  readonly ownerId: string;
  readonly redirectUri: string;
  readonly stateHash: string;
  readonly subjectId: string;
}

export interface StoredCredential {
  readonly accessToken: Secret;
  readonly refreshToken: Secret | null;
  readonly tokenType: string;
}

export class AuthorizationError extends S.TaggedError<AuthorizationError>()("AuthorizationError", {
  message: S.String,
}) {}

export function assertGrant(
  connection: Connection,
  authorization: ProviderAuthorization.ProviderAuthorization,
  request: {
    readonly capability: ProviderAuthorization.Capability;
    readonly domain: string;
    readonly now?: Date;
    readonly providerId: string;
  },
): DomainName.DomainName {
  if (
    connection.authorizationId !== authorization.id ||
    authorization.providerId !== request.providerId
  ) {
    throw new AuthorizationError({ message: "Connection does not grant this provider account" });
  }
  if (authorization.expiresAt !== null) {
    if (Number.isNaN(authorization.expiresAt.getTime())) {
      throw new AuthorizationError({ message: "Connection expiration is invalid" });
    }
    if (authorization.expiresAt <= (request.now ?? new Date())) {
      throw new AuthorizationError({ message: "Connection has expired" });
    }
  }
  if (!authorization.capabilities.includes(request.capability)) {
    throw new AuthorizationError({
      message: `Connection lacks the ${request.capability} capability`,
    });
  }
  let domain: DomainName.DomainName;
  try {
    domain = DomainName.parse(request.domain);
  } catch (cause) {
    if (cause instanceof InvalidInputError) throw cause;
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (connection.grant._tag === "domains" && !connection.grant.domains.includes(domain)) {
    throw new AuthorizationError({ message: "Connection does not grant this domain" });
  }
  return domain;
}
