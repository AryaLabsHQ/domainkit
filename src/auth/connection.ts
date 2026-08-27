import { Effect, Schema as S } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import type { Value as Secret } from "./secret.ts";
import type { OAuthMethod } from "./manifest.ts";

export const Capability = S.Literals(["dns:read", "dns:write"]);
export type Capability = typeof Capability.Type;

export const Grant = S.TaggedUnion({
  account: {},
  domains: { domains: S.Array(DomainName.Schema) },
});
export type Grant = typeof Grant.Type;

export const Schema = S.Struct({
  accountId: S.String,
  capabilities: S.Array(Capability),
  createdAt: S.DateFromString,
  expiresAt: S.NullOr(S.DateFromString),
  grant: Grant,
  id: S.String,
  kind: S.Literals(["oauth2", "token"]),
  providerId: S.String,
  scopes: S.Array(S.String),
  subjectId: S.String,
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
  request: {
    readonly accountId: string;
    readonly capability: Capability;
    readonly domain: string;
    readonly now?: Date;
    readonly providerId: string;
  },
): DomainName.DomainName {
  if (connection.providerId !== request.providerId || connection.accountId !== request.accountId) {
    throw new AuthorizationError({ message: "Connection does not grant this provider account" });
  }
  if (connection.expiresAt !== null) {
    if (Number.isNaN(connection.expiresAt.getTime())) {
      throw new AuthorizationError({ message: "Connection expiration is invalid" });
    }
    if (connection.expiresAt <= (request.now ?? new Date())) {
      throw new AuthorizationError({ message: "Connection has expired" });
    }
  }
  if (!connection.capabilities.includes(request.capability)) {
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
