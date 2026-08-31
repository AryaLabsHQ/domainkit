import { Effect, Schema as S } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import type { OAuthMethod } from "./manifest.ts";
import type * as ProviderAuthorization from "./authorization.ts";
import type { Value as Secret } from "./secret.ts";

/** A provider account and authoritative zone selected for one domain attachment. */
export const ProviderTarget = S.Struct({
  accountId: S.String,
  accountKind: S.NullOr(S.Literals(["account", "personal", "team"])),
  zoneId: S.String,
  zoneName: DomainName.Schema,
});
export interface ProviderTarget extends S.Schema.Type<typeof ProviderTarget> {}

/** The lifecycle state visible to a host for an organization connection. */
export const ConnectionStatus = S.Literals(["active", "expired", "revocation-pending"]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

/** An organization-scoped provider connection. */
export const ProviderConnection = S.Struct({
  createdAt: S.DateFromString,
  id: S.String,
  method: S.Literals(["integration", "oauth2", "token"]),
  ownerId: S.String,
  providerId: S.String,
  status: ConnectionStatus,
});
export interface ProviderConnection extends S.Schema.Type<typeof ProviderConnection> {}

/** An exact provider target attached to one organization domain. */
export const DomainAttachment = S.Struct({
  connectionId: S.String,
  createdAt: S.DateFromString,
  domain: DomainName.Schema,
  id: S.String,
  target: ProviderTarget,
});
export interface DomainAttachment extends S.Schema.Type<typeof DomainAttachment> {}

/** Internal connection row; the authorization id is intentionally not part of the public shape. */
export const StoredConnection = S.Struct({
  authorizationId: S.String,
  createdAt: S.DateFromString,
  id: S.String,
  method: S.Literals(["integration", "oauth2", "token"]),
  ownerId: S.String,
  providerId: S.String,
});
export interface StoredConnection extends S.Schema.Type<typeof StoredConnection> {}

/** Internal credential material retained by the host's persistence implementation. */
export interface StoredCredential {
  readonly accessToken: Secret;
  readonly refreshToken: Secret | null;
  readonly tokenType: string;
}

/** The provider context carried through an interactive connection continuation. */
export interface OAuthContinuation {
  readonly clientId: string;
  readonly codeVerifier: Secret;
  readonly expiresAt: Date;
  readonly authorizationId?: string;
  readonly method: OAuthMethod;
  readonly ownerId: string;
  readonly redirectUri: string;
  readonly stateHash: string;
  readonly authorizedById: string;
}

export class AuthorizationError extends S.TaggedError<AuthorizationError>()("AuthorizationError", {
  category: S.Literal("authorization"),
  message: S.String,
  operation: S.String,
  retry: S.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export const authorizationError = (message: string, operation: string): AuthorizationError =>
  new AuthorizationError({
    category: "authorization",
    message,
    operation,
    retry: "after-user-action",
  });

/** Decode a public connection snapshot returned by a host. */
export const decode = Effect.fn("ProviderConnection.decode")((input: unknown) =>
  S.decodeUnknownEffect(ProviderConnection)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const validate = Effect.fn("ProviderConnection.validate")((input: unknown) =>
  S.decodeUnknownEffect(S.toType(ProviderConnection))(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const encode = S.encodeSync(ProviderConnection);

/** Derive a public connection projection from its private authorization state. */
export function project(
  connection: StoredConnection,
  authorization: ProviderAuthorization.ProviderAuthorization,
  now = new Date(),
): ProviderConnection {
  const status: ConnectionStatus =
    authorization.revocation._tag === "Pending"
      ? "revocation-pending"
      : authorization.expiresAt !== null && authorization.expiresAt <= now
        ? "expired"
        : "active";
  return {
    createdAt: connection.createdAt,
    id: connection.id,
    method: connection.method,
    ownerId: connection.ownerId,
    providerId: connection.providerId,
    status,
  };
}

/** Assert that an exact attachment is usable for one DNS operation. */
export function assertAttachment(input: {
  readonly attachment: DomainAttachment;
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly capability: ProviderAuthorization.Capability;
  readonly connection: StoredConnection | ProviderConnection;
  readonly domain: string;
  readonly now?: Date;
  readonly providerId: string;
}): DomainName.DomainName {
  if (
    input.connection.providerId !== input.providerId ||
    input.authorization.providerId !== input.providerId ||
    input.authorization.revocation._tag !== "Active" ||
    input.attachment.connectionId !== input.connection.id
  ) {
    throw authorizationError(
      "Domain attachment is not active for this provider",
      "Connection.assertAttachment",
    );
  }
  if (input.authorization.expiresAt !== null) {
    if (Number.isNaN(input.authorization.expiresAt.getTime())) {
      throw authorizationError(
        "Provider authorization expiration is invalid",
        "Connection.assertAttachment",
      );
    }
    if (input.authorization.expiresAt <= (input.now ?? new Date())) {
      throw authorizationError("Provider authorization has expired", "Connection.assertAttachment");
    }
  }
  if (!input.authorization.requiredCapabilities.includes(input.capability)) {
    throw authorizationError(
      `Provider authorization lacks the ${input.capability} capability`,
      "Connection.assertAttachment",
    );
  }
  if (
    !input.authorization.capabilityEvidence.some((item) => item.capability === input.capability)
  ) {
    throw authorizationError(
      `Provider authorization has no evidence for the ${input.capability} capability`,
      "Connection.assertAttachment",
    );
  }
  let domain: DomainName.DomainName;
  try {
    domain = DomainName.parse(input.domain);
  } catch (cause) {
    if (cause instanceof InvalidInputError) throw cause;
    throw new InvalidInputError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (input.attachment.domain !== domain && !domain.endsWith(`.${input.attachment.domain}`)) {
    throw authorizationError(
      "Domain attachment does not match the requested domain",
      "Connection.assertAttachment",
    );
  }
  return domain;
}
