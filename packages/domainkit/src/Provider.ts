/**
 * One declarative definition per DNS provider. Auth methods are optional cases, so a provider that
 * only issues personal tokens declares `token` and nothing else. The definition drives connection
 * routes, refresh, the UI method catalog, and rebuilding a session from stored context.
 */
import { Data, type DateTime, Effect, Redacted, Schema } from "effect";

import type * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import type { Capability } from "./Storage.ts";

export type Fx<A> = Effect.Effect<A, Errors.DomainKitError>;

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
    record: DnsRecord.Model,
  ) => Fx<{ readonly providerRecordId: string }>;
  readonly get: (zone: string, providerRecordId: string) => Fx<DnsRecord.Observed | null>;
  readonly delete: (zone: string, providerRecordId: string) => Fx<void>;
}

/** A zone the credential can reach, with the provider identity needed to address it later. */
export interface Target {
  readonly zone: string;
  readonly context: unknown;
  readonly label: string;
  /** The zone's nameservers as the provider reports them; `Connect.discover` matches on them. */
  readonly nameservers?: ReadonlyArray<string>;
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
): Effect.Effect<Schema.Struct<Fields>["Type"], Errors.DomainKitError> => {
  const raw: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) raw[name] = Redacted.value(value);
  }
  return Errors.decode(fields, raw, "method");
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

/**
 * Every method a provider offers, in the order a UI should present them: the interactive ones a
 * customer clicks through first, then the token they have to go and fetch themselves.
 */
export const describeMethods = (definition: Definition): ReadonlyArray<MethodDescriptor> => {
  const found: Array<MethodDescriptor> = [];
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
  if (definition.auth.token !== undefined) {
    found.push({
      kind: "token",
      label: definition.auth.token.label,
      docsUrl: definition.auth.token.docsUrl ?? null,
      fields: tokenFields(definition.auth.token),
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
  /**
   * Hostname suffixes of the nameservers this provider operates, e.g. `ns.cloudflare.com`.
   * `Connect.discover` names the provider as a domain's host when every authoritative nameserver
   * ends in one of them.
   */
  readonly nameservers?: ReadonlyArray<string>;
  readonly auth: {
    readonly token?: TokenAuth;
    readonly oauth?: OAuthAuth;
    readonly integration?: IntegrationAuth;
  };
  /** Schema for the account/zone context stored on authorizations and attachments. */
  readonly context: Schema.Codec<Context, unknown, never, never>;
  /** Tag written into every stored context envelope, e.g. `cloudflare.v1`; bump it with the schema. */
  readonly contextVersion: string;
  /** Upgrade an envelope written under an older `contextVersion`; absent means `Unsupported`. */
  readonly migrateContext?: (envelope: Envelope) => Fx<Context>;
  readonly session: (credential: Credential) => Session;
}

/** How provider context is persisted: the definition's version tag beside the encoded value. */
export const Envelope = Schema.Struct({ version: Schema.String, value: Schema.Unknown });
export type Envelope = typeof Envelope.Type;

/** Wrap a context value for storage; a value the schema rejects fails `InvalidInput`. */
export const encodeContext = <Context>(
  definition: Definition<Context>,
  value: Context,
): Effect.Effect<Envelope, Errors.DomainKitError> =>
  Schema.encodeEffect(definition.context)(value).pipe(
    Effect.map((encoded) => ({ version: definition.contextVersion, value: encoded })),
    Effect.mapError(
      (cause) =>
        new Errors.DomainKitError({
          reason: new Reason.InvalidInput({ message: cause.message, field: "context" }),
        }),
    ),
  );

export type AuthMethod = "token" | "oauth" | "integration";

/** Validates a definition: an id and at least one auth method. Throws `DomainKit.Error` otherwise. */
export const make = <Context>(definition: Definition<Context>): Definition<Context> => {
  const invalid = (message: string, field: string) =>
    new Errors.DomainKitError({
      reason: new Reason.InvalidInput({ message, field }),
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
  if (definition.contextVersion.length === 0) {
    throw invalid(`Provider ${definition.id} needs a contextVersion`, "contextVersion");
  }
  return definition;
};

/** The kinds alone, in the same order `describeMethods` puts them: interactive first, token last. */
export const methods = (definition: Definition): ReadonlyArray<AuthMethod> =>
  describeMethods(definition).map((method) => method.kind);

/**
 * Pick the most specific zone among `targets` for `domain`: exactly one match resolves, several
 * matches at the same depth need a selection, none is `NotFound`.
 */
export const resolveAmong = (
  domain: DomainName.Model,
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

/**
 * Decode a stored envelope: the current version decodes with `context`, an older one goes
 * through `migrateContext`, anything else fails `Unsupported`.
 */
export const decodeContext = <Context>(
  definition: Definition<Context>,
  stored: unknown,
): Effect.Effect<Context, Errors.DomainKitError> =>
  Errors.decode(Envelope, stored, "context").pipe(
    Effect.flatMap((envelope) => {
      if (envelope.version === definition.contextVersion) {
        return Errors.decode(definition.context, envelope.value, "context");
      }
      if (definition.migrateContext !== undefined) return definition.migrateContext(envelope);
      return Errors.fail(
        new Reason.Unsupported({
          provider: definition.id,
          operation: "context",
          message: `${definition.id} context version ${envelope.version} is not supported (current ${definition.contextVersion})`,
        }),
      );
    }),
  );

export {
  type AsyncCredential,
  type AsyncDefinition,
  type AsyncDns,
  type AsyncIntegrationAuth,
  type AsyncIssuedCredential,
  type AsyncOAuthAuth,
  type AsyncSession,
  type AsyncTokenAuth,
  fromAsync,
} from "./internal/provider-async.ts";
