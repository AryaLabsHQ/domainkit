/**
 * One declarative definition per DNS provider. Auth methods are optional cases, so a provider that
 * only issues personal tokens declares `token` and nothing else. The definition drives connection
 * routes, refresh, the UI method catalog, and rebuilding a session from stored context.
 */
import { Data, type DateTime, Effect, Redacted, Schema } from "effect";

import type * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
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
  /** Must return the provider's id for the new record; cleanup deletes by that id. */
  readonly create: (
    zone: string,
    record: DnsRecord.DnsRecord,
  ) => Fx<{ readonly providerRecordId: string }>;
  readonly get: (zone: string, providerRecordId: string) => Fx<DnsRecord.Observed | null>;
  readonly delete: (zone: string, providerRecordId: string) => Fx<void>;
}

/** A zone the credential can reach, with the provider identity needed to address it later. */
export interface Target {
  readonly zone: string;
  readonly context: unknown;
  readonly label: string;
}

export type Resolution = Data.TaggedEnum<{
  Resolved: { readonly target: Target };
  SelectionRequired: { readonly candidates: ReadonlyArray<Target> };
  NotFound: {};
}>;
export const Resolution = Data.taggedEnum<Resolution>();

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

/** Raw token-method input keyed by the provider's declared field names. */
export type TokenValues = Readonly<Record<string, Redacted.Redacted<string> | undefined>>;

export interface TokenAuth {
  readonly label: string;
  /** Where the customer creates the token; shown in the UI. */
  readonly docsUrl?: string;
  readonly requiredCapabilities: ReadonlyArray<Capability>;
  /**
   * The values this method needs, declared once so forms render from it: secrets as
   * `Schema.RedactedFromValue(Schema.String)`, optional ones through `Schema.optionalKey`.
   */
  readonly fields: Schema.Struct<Schema.Struct.Fields>;
  /** Validate the values (already decoded with `fields`) and return account context. */
  readonly authenticate: (values: TokenValues) => Fx<IssuedCredential>;
}

/** Build a `TokenAuth` whose `authenticate` receives the record decoded by `fields`. */
/** Field schemas whose decoding needs no services, so `authenticate` stays a plain `Fx`. */
export type TokenFieldSchemas = { readonly [name: string]: Schema.ConstraintDecoder<unknown> };

export const tokenAuth = <const Fields extends TokenFieldSchemas>(input: {
  readonly label: string;
  readonly docsUrl?: string;
  readonly requiredCapabilities: ReadonlyArray<Capability>;
  readonly fields: Schema.Struct<Fields>;
  readonly authenticate: (values: Schema.Struct<Fields>["Type"]) => Fx<IssuedCredential>;
}): TokenAuth => ({
  label: input.label,
  ...(input.docsUrl === undefined ? {} : { docsUrl: input.docsUrl }),
  requiredCapabilities: input.requiredCapabilities,
  fields: input.fields as Schema.Struct<Schema.Struct.Fields>,
  authenticate: (values) =>
    decodeTokenValues(input.fields, values).pipe(Effect.flatMap(input.authenticate)),
});

const decodeTokenValues = <Fields extends TokenFieldSchemas>(
  fields: Schema.Struct<Fields>,
  values: TokenValues,
): Effect.Effect<Schema.Struct<Fields>["Type"], DomainKitError.DomainKitError> => {
  const raw: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) raw[name] = Redacted.value(value);
  }
  return DomainKitError.decode(fields, raw, "method");
};

export interface FieldDescriptor {
  readonly name: string;
  readonly required: boolean;
  readonly secret: boolean;
}

/** What a UI needs to render one auth method; `fields` is `null` for interactive methods. */
export interface MethodDescriptor {
  readonly kind: AuthMethod;
  readonly label: string;
  readonly docsUrl: string | null;
  readonly fields: ReadonlyArray<FieldDescriptor> | null;
}

/** Field descriptors derived from `TokenAuth.fields`: optional keys are not required, `Redacted` values are secret. */
export const tokenFields = (auth: TokenAuth): ReadonlyArray<FieldDescriptor> =>
  Object.entries(auth.fields.fields).map(([name, field]) => {
    const ast = (field as { readonly ast: FieldAst }).ast;
    return {
      name,
      required: ast.context?.isOptional !== true,
      secret: ast._tag === "Declaration",
    };
  });

interface FieldAst {
  readonly _tag: string;
  readonly context?: { readonly isOptional?: boolean } | undefined;
}

export const describeMethods = (definition: Definition): ReadonlyArray<MethodDescriptor> => {
  const found: Array<MethodDescriptor> = [];
  if (definition.auth.token !== undefined) {
    found.push({
      kind: "token",
      label: definition.auth.token.label,
      docsUrl: definition.auth.token.docsUrl ?? null,
      fields: tokenFields(definition.auth.token),
    });
  }
  if (definition.auth.oauth !== undefined) {
    found.push({ kind: "oauth", label: definition.auth.oauth.label, docsUrl: null, fields: null });
  }
  if (definition.auth.integration !== undefined) {
    found.push({
      kind: "integration",
      label: definition.auth.integration.label,
      docsUrl: null,
      fields: null,
    });
  }
  return found;
};

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

/**
 * Pick the most specific zone among `targets` for `domain`: exactly one match resolves, several
 * matches at the same depth need a selection, none is `NotFound`.
 */
export const resolveAmong = (
  domain: DomainName.DomainName,
  targets: ReadonlyArray<Target>,
): Resolution => {
  for (const candidate of DomainName.candidates(domain)) {
    const matches = targets.filter((target) => target.zone === candidate);
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) return Resolution.Resolved({ target: only });
    if (matches.length > 1) return Resolution.SelectionRequired({ candidates: matches });
  }
  return Resolution.NotFound();
};

/** Decode stored context with the definition's schema; a mismatch is `InvalidInput`. */
export const decodeContext = <Context>(
  definition: Definition<Context>,
  context: unknown,
): Effect.Effect<Context, DomainKitError.DomainKitError> =>
  DomainKitError.decode(definition.context, context, "context");
