import { DateTime, Effect, Redacted, type Schema } from "effect";

import * as DomainKitError from "../DomainKitError.ts";
import type * as DnsRecord from "../DnsRecord.ts";
import * as Provider from "../Provider.ts";
import type { Capability } from "../Storage.ts";

/** Plain-object credential for Promise-shaped providers; `secret` is the raw string. */
export interface AsyncCredential {
  readonly secret: string;
  readonly context: unknown;
}

export interface AsyncIssuedCredential extends AsyncCredential {
  readonly expiresAt: Date | null;
}

export interface AsyncDns {
  readonly list: (zone: string) => Promise<ReadonlyArray<Provider.ObservedRecord>>;
  readonly create: (
    zone: string,
    record: DnsRecord.DnsRecord,
  ) => Promise<{ readonly providerRecordId: string }>;
  readonly get: (zone: string, providerRecordId: string) => Promise<DnsRecord.Observed | null>;
  readonly delete: (zone: string, providerRecordId: string) => Promise<void>;
}

export interface AsyncSession {
  readonly listTargets: () => Promise<ReadonlyArray<Provider.Target>>;
  readonly resolveTarget: (domain: string) => Promise<Provider.Resolution>;
  readonly dns: (target: Provider.Target) => AsyncDns;
  readonly capabilities: () => Promise<ReadonlyArray<Capability>>;
}

export interface AsyncTokenAuth {
  readonly label: string;
  readonly docsUrl?: string;
  readonly requiredCapabilities: ReadonlyArray<Capability>;
  readonly fields: Schema.Struct<Provider.TokenFieldSchemas>;
  /** Decoded field values with secrets unwrapped to strings. */
  readonly authenticate: (
    values: Readonly<Record<string, string | undefined>>,
  ) => Promise<AsyncIssuedCredential>;
}

export interface AsyncOAuthAuth {
  readonly label: string;
  readonly scopes: ReadonlyArray<string>;
  readonly start: (input: {
    readonly state: string;
    readonly callbackUrl: string;
    readonly codeChallenge: string;
  }) => Promise<{ readonly authorizationUrl: string }>;
  readonly complete: (
    input: Provider.CallbackInput & { readonly codeVerifier: string },
  ) => Promise<AsyncIssuedCredential>;
  readonly refresh: (credential: AsyncCredential) => Promise<AsyncIssuedCredential>;
  readonly revoke?: (credential: AsyncCredential) => Promise<void>;
}

export interface AsyncIntegrationAuth {
  readonly label: string;
  readonly start: (input: {
    readonly state: string;
    readonly callbackUrl: string;
  }) => Promise<{ readonly authorizationUrl: string }>;
  readonly complete: (input: Provider.CallbackInput) => Promise<AsyncIssuedCredential>;
  readonly refresh?: (credential: AsyncCredential) => Promise<AsyncIssuedCredential>;
  readonly revoke?: (credential: AsyncCredential) => Promise<void>;
}

/** `Provider.Definition` with every operation returning a Promise. */
export interface AsyncDefinition<Context = unknown> {
  readonly id: string;
  readonly name: string;
  readonly auth: {
    readonly token?: AsyncTokenAuth;
    readonly oauth?: AsyncOAuthAuth;
    readonly integration?: AsyncIntegrationAuth;
  };
  readonly context: Schema.Codec<Context, unknown, never, never>;
  readonly contextVersion: string;
  readonly migrateContext?: (envelope: Provider.Envelope) => Promise<Context>;
  readonly session: (credential: AsyncCredential) => AsyncSession;
}

const failure = (provider: string) => (cause: unknown) =>
  DomainKitError.isDomainKitError(cause)
    ? cause
    : new DomainKitError.DomainKitError({
        reason: new DomainKitError.ProviderUnavailable({
          provider,
          message: cause instanceof Error ? cause.message : `${provider} request failed`,
        }),
      });

const issued = (value: AsyncIssuedCredential): Provider.IssuedCredential => ({
  secret: Redacted.make(value.secret),
  context: value.context,
  expiresAt: value.expiresAt === null ? null : DateTime.fromDateUnsafe(value.expiresAt),
});

const plain = (credential: Provider.Credential): AsyncCredential => ({
  secret: Redacted.value(credential.secret),
  context: credential.context,
});

/** Adapt a Promise-shaped provider; rejections become `DomainKitError` (a thrown one passes through). */
export const fromAsync = <Context>(
  definition: AsyncDefinition<Context>,
): Provider.Definition<Context> => {
  const call = <A>(run: () => Promise<A>): Provider.Fx<A> =>
    Effect.tryPromise({ try: run, catch: failure(definition.id) });
  const dns = (target: Provider.Target, inner: AsyncDns): Provider.Dns => ({
    list: (zone) => call(() => inner.list(zone)),
    create: (zone, record) => call(() => inner.create(zone, record)),
    get: (zone, providerRecordId) => call(() => inner.get(zone, providerRecordId)),
    delete: (zone, providerRecordId) => call(() => inner.delete(zone, providerRecordId)),
  });
  const session = (credential: Provider.Credential): Provider.Session => {
    const inner = definition.session(plain(credential));
    return {
      listTargets: () => call(() => inner.listTargets()),
      resolveTarget: (domain) => call(() => inner.resolveTarget(domain)),
      capabilities: () => call(() => inner.capabilities()),
      dns: (target) => dns(target, inner.dns(target)),
    };
  };
  const token = definition.auth.token;
  const oauth = definition.auth.oauth;
  const integration = definition.auth.integration;
  const migrate = definition.migrateContext;
  const oauthRevoke = oauth?.revoke;
  const integrationRefresh = integration?.refresh;
  const integrationRevoke = integration?.revoke;
  return Provider.make<Context>({
    id: definition.id,
    name: definition.name,
    context: definition.context,
    contextVersion: definition.contextVersion,
    ...(migrate === undefined
      ? {}
      : {
          migrateContext: (envelope: Provider.Envelope) => call(() => migrate(envelope)),
        }),
    auth: {
      ...(token === undefined
        ? {}
        : {
            token: Provider.tokenAuth({
              label: token.label,
              ...(token.docsUrl === undefined ? {} : { docsUrl: token.docsUrl }),
              requiredCapabilities: token.requiredCapabilities,
              fields: token.fields,
              authenticate: (values) =>
                call(() =>
                  token.authenticate(
                    Object.fromEntries(
                      Object.entries(values as Record<string, unknown>).map(([name, value]) => [
                        name,
                        Redacted.isRedacted(value)
                          ? String(Redacted.value(value))
                          : value === undefined
                            ? undefined
                            : String(value),
                      ]),
                    ),
                  ),
                ).pipe(Effect.map(issued)),
            }),
          }),
      ...(oauth === undefined
        ? {}
        : {
            oauth: {
              label: oauth.label,
              scopes: oauth.scopes,
              start: (input) => call(() => oauth.start(input)),
              complete: (input) => call(() => oauth.complete(input)).pipe(Effect.map(issued)),
              refresh: (credential) =>
                call(() => oauth.refresh(plain(credential))).pipe(Effect.map(issued)),
              ...(oauthRevoke === undefined
                ? {}
                : {
                    revoke: (credential: Provider.Credential) =>
                      call(() => oauthRevoke(plain(credential))),
                  }),
            } satisfies Provider.OAuthAuth,
          }),
      ...(integration === undefined
        ? {}
        : {
            integration: {
              label: integration.label,
              start: (input) => call(() => integration.start(input)),
              complete: (input) => call(() => integration.complete(input)).pipe(Effect.map(issued)),
              ...(integrationRefresh === undefined
                ? {}
                : {
                    refresh: (credential: Provider.Credential) =>
                      call(() => integrationRefresh(plain(credential))).pipe(Effect.map(issued)),
                  }),
              ...(integrationRevoke === undefined
                ? {}
                : {
                    revoke: (credential: Provider.Credential) =>
                      call(() => integrationRevoke(plain(credential))),
                  }),
            } satisfies Provider.IntegrationAuth,
          }),
    },
    session,
  });
};
