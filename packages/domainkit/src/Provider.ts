/**
 * One declarative definition per DNS provider. Auth methods are optional cases, so a provider that
 * only issues personal tokens declares `token` and nothing else. The definition drives connection
 * routes, refresh, the UI method catalog, and rebuilding a session from stored context.
 */
import type { DateTime, Effect, Redacted, Schema } from "effect";

import type * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import type { Capability } from "./Storage.ts";

export type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError>;

/** A record as the provider reports it, with the id needed to read or delete it later. */
export interface ObservedRecord {
  readonly record: DnsRecord.Observed;
  readonly providerRecordId: string | null;
}

/** What a session can do inside one zone. The only thing planning and applying touch. */
export interface Dns {
  readonly list: (zone: string) => Fx<ReadonlyArray<ObservedRecord>>;
  readonly create: (
    zone: string,
    record: DnsRecord.DnsRecord,
  ) => Fx<{ readonly providerRecordId: string | null }>;
  readonly get: (zone: string, providerRecordId: string) => Fx<DnsRecord.Observed | null>;
  readonly delete: (zone: string, providerRecordId: string) => Fx<void>;
}

/** A zone the credential can reach, with the provider identity needed to address it later. */
export interface Target {
  readonly zone: string;
  readonly context: unknown;
  readonly label: string;
}

export type Resolution =
  | { readonly _tag: "Resolved"; readonly target: Target }
  | { readonly _tag: "SelectionRequired"; readonly candidates: ReadonlyArray<Target> }
  | { readonly _tag: "NotFound" };

/** A credential bound to provider account context. */
export interface Session {
  readonly listTargets: () => Fx<ReadonlyArray<Target>>;
  readonly resolveTarget: (domain: string) => Fx<Resolution>;
  readonly dns: (target: Target) => Dns;
  /** Capabilities actually held; promoted onto the authorization after first use. */
  readonly capabilities: () => Fx<ReadonlyArray<Capability>>;
}

/**
 * Secret material plus the account context needed to rebuild a session. `secret` is opaque to
 * DomainKit: a provider may pack an access token and a refresh token into it.
 */
export interface Credential {
  readonly secret: Redacted.Redacted<string>;
  readonly context: unknown;
}

/** A credential the provider just issued or refreshed; `null` expiry means it does not expire. */
export interface IssuedCredential extends Credential {
  readonly expiresAt: DateTime.Utc | null;
}

export interface TokenAuth {
  readonly label: string;
  /** Where the customer creates the token; shown in the UI. */
  readonly docsUrl?: string;
  readonly requiredCapabilities: ReadonlyArray<Capability>;
  /** Validate the token and return account context. */
  readonly authenticate: (token: Redacted.Redacted<string>) => Fx<IssuedCredential>;
}

export interface CallbackInput {
  readonly code: string;
  /** The redirect URI registered at start; token exchanges echo it. */
  readonly callbackUrl: string;
  /** Every query parameter the provider appended to the callback. */
  readonly params: Readonly<Record<string, string>>;
}

export interface OAuthAuth {
  readonly label: string;
  readonly scopes: ReadonlyArray<string>;
  readonly start: (input: {
    readonly state: string;
    readonly callbackUrl: string;
    readonly codeChallenge: string;
  }) => Fx<{ readonly authorizationUrl: string }>;
  readonly complete: (
    input: CallbackInput & { readonly codeVerifier: string },
  ) => Fx<IssuedCredential>;
  readonly refresh: (credential: Credential) => Fx<IssuedCredential>;
  readonly revoke?: (credential: Credential) => Fx<void>;
}

/** Marketplace-style installs (Vercel integrations) that redirect but are not OAuth. */
export interface IntegrationAuth {
  readonly label: string;
  readonly start: (input: {
    readonly state: string;
    readonly callbackUrl: string;
  }) => Fx<{ readonly authorizationUrl: string }>;
  readonly complete: (input: CallbackInput) => Fx<IssuedCredential>;
  readonly refresh?: (credential: Credential) => Fx<IssuedCredential>;
  readonly revoke?: (credential: Credential) => Fx<void>;
}

export interface Definition<Context = unknown> {
  readonly id: string;
  readonly name: string;
  readonly auth: {
    readonly token?: TokenAuth;
    readonly oauth?: OAuthAuth;
    readonly integration?: IntegrationAuth;
  };
  /** Schema for the account/zone context stored on authorizations and attachments. */
  readonly context: Schema.Codec<Context, unknown, never, never>;
  readonly session: (credential: Credential) => Session;
}

export type AuthMethod = "token" | "oauth" | "integration";

/** Validates a definition: an id and at least one auth method. Throws `DomainKitError` otherwise. */
export const make = <Context>(definition: Definition<Context>): Definition<Context> => {
  const invalid = (message: string, field: string) =>
    new DomainKitError.DomainKitError({
      reason: new DomainKitError.InvalidInput({ message, field }),
    });
  if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.id)) {
    throw invalid(
      `Provider id ${JSON.stringify(definition.id)} must be lowercase kebab-case`,
      "id",
    );
  }
  if (methods(definition).length === 0) {
    throw invalid(`Provider ${definition.id} declares no auth method`, "auth");
  }
  return definition;
};

export const methods = (definition: Definition): ReadonlyArray<AuthMethod> => {
  const found: Array<AuthMethod> = [];
  if (definition.auth.token !== undefined) found.push("token");
  if (definition.auth.oauth !== undefined) found.push("oauth");
  if (definition.auth.integration !== undefined) found.push("integration");
  return found;
};

/** Decode stored context with the definition's schema; a mismatch is `InvalidInput`. */
export const decodeContext = <Context>(
  definition: Definition<Context>,
  context: unknown,
): Effect.Effect<Context, DomainKitError.DomainKitError> =>
  DomainKitError.decode(definition.context, context, "context");
