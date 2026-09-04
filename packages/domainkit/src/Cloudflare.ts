/** Cloudflare: personal API tokens and OAuth. */
import { type Config, Effect, Redacted, Schema } from "effect";

import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import * as Client from "./internal/cloudflare/client.ts";
import type * as Protocol from "./internal/cloudflare/protocol.ts";
import { resolve } from "./internal/config.ts";
import type { Fetch } from "./internal/http.ts";
import * as OAuth from "./internal/oauth.ts";
import * as Provider from "./Provider.ts";

/**
 * Authorization context: `accountId` is `null` when the credential spans several accounts or
 * none yet. Target context: the zone's account and zone id.
 */
export const AccountContext = Schema.Struct({
  accountId: Schema.NullOr(Schema.String),
  /** How the token was verified: user tokens span accounts, account tokens are pinned. */
  tokenKind: Schema.optionalKey(Schema.Literals(["user", "account"])),
  zoneId: Schema.optionalKey(Schema.String),
});

/** Token-method input: the API token, and the account id for account-owned tokens. */
export const TokenFields = Schema.Struct({
  token: Schema.RedactedFromValue(Schema.String),
  accountId: Schema.optionalKey(Schema.String),
});
export type AccountContext = typeof AccountContext.Type;

export interface Options {
  /** Omit to offer tokens only. */
  readonly oauth?: {
    readonly clientId: string | Config.Config<string>;
    readonly clientSecret: Redacted.Redacted<string> | Config.Config<Redacted.Redacted<string>>;
    /** Scope ids assigned to the OAuth client. Default: `zone:read`, `dns_records:edit`, `offline_access`. */
    readonly scopes?: ReadonlyArray<string>;
    /** Default `client_secret_basic`. */
    readonly clientAuth?: OAuth.ClientAuth;
    /**
     * Origin for consent, token exchange, and revocation, which Cloudflare serves at
     * `/oauth2/auth`, `/oauth2/token`, and `/oauth2/revoke` beneath it. Default
     * `https://dash.cloudflare.com`; a stage points it at an emulator that mounts the same three
     * paths. It stays separate from `baseUrl` because in production these are different hosts:
     * `dash.cloudflare.com` for OAuth, `api.cloudflare.com/client/v4` for the REST API.
     */
    readonly issuer?: string;
  };
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
}

const defaultIssuer = "https://dash.cloudflare.com";

/** The three OAuth endpoints Cloudflare serves under one origin. */
const endpointsOf = (origin: string): OAuth.Server => {
  const base = origin.replace(/\/$/, "");
  return {
    authorization_endpoint: `${base}/oauth2/auth`,
    issuer: base,
    revocation_endpoint: `${base}/oauth2/revoke`,
    token_endpoint: `${base}/oauth2/token`,
  };
};

export const server: OAuth.Server = endpointsOf(defaultIssuer);

const defaultScopes = ["zone:read", "dns_records:edit", "offline_access"];
const capabilities = ["dns:read", "dns:write"] as const;

/** OAuth credentials pack both tokens into `secret`; token credentials are the token itself. */
const Secret = Schema.fromJsonString(
  Schema.Struct({ accessToken: Schema.String, refreshToken: Schema.NullOr(Schema.String) }),
);

const parseSecret = (secret: Redacted.Redacted<string>) => {
  const raw = Redacted.value(secret);
  const parsed = raw.startsWith("{") ? Schema.decodeUnknownOption(Secret)(raw) : undefined;
  return parsed !== undefined && parsed._tag === "Some"
    ? parsed.value
    : { accessToken: raw, refreshToken: null };
};

const packSecret = (tokens: OAuth.Tokens) =>
  Redacted.make(
    Schema.encodeSync(Secret)({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }),
  );

export const provider = (options: Options = {}): Provider.Definition<AccountContext> => {
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
  const client = (token: string): Client.Options => ({ token, fetch, baseUrl });

  const discoverAccount = (token: string) =>
    Client.listZones(client(token)).pipe(
      Effect.map((zones) => {
        const accounts = new Set(zones.map((zone) => zone.account.id));
        const [only] = accounts;
        return accounts.size === 1 && only !== undefined ? only : null;
      }),
    );

  const targetOf = (zone: Protocol.Zone): Provider.Target => ({
    zone: zone.name,
    context: { accountId: zone.account.id, zoneId: zone.id } satisfies AccountContext,
    label: `${zone.name} (${zone.account.name})`,
    nameservers: zone.name_servers ?? [],
  });

  const oauthClient = (oauth: NonNullable<Options["oauth"]>) =>
    Effect.gen(function* () {
      const clientId = yield* resolve(oauth.clientId, "oauth.clientId");
      const clientSecret = yield* resolve(oauth.clientSecret, "oauth.clientSecret");
      return {
        clientId,
        clientSecret,
        clientAuth: oauth.clientAuth ?? "client_secret_basic",
      } satisfies OAuth.Client;
    });

  const issued = (
    tokens: OAuth.Tokens,
  ): Effect.Effect<Provider.IssuedCredential, Errors.DomainKitError> =>
    discoverAccount(tokens.accessToken).pipe(
      Effect.map((accountId) => ({
        secret: packSecret(tokens),
        context: { accountId } satisfies AccountContext,
        expiresAt: tokens.expiresAt,
      })),
    );

  const oauth = options.oauth === undefined ? undefined : oauthAuth(options.oauth);

  function oauthAuth(settings: NonNullable<Options["oauth"]>): Provider.OAuthAuth {
    const scopes = settings.scopes ?? defaultScopes;
    const endpoints = settings.issuer === undefined ? server : endpointsOf(settings.issuer);
    return {
      label: "Sign in with Cloudflare",
      scopes,
      start: (input) =>
        oauthClient(settings).pipe(
          Effect.map(({ clientId }) => ({
            authorizationUrl: OAuth.authorizationUrl({
              server: endpoints,
              clientId,
              scopes,
              state: input.state,
              callbackUrl: input.callbackUrl,
              codeChallenge: input.codeChallenge,
            }),
          })),
        ),
      complete: (input) =>
        oauthClient(settings).pipe(
          Effect.flatMap((oauthClientValue) =>
            OAuth.exchangeCode({
              provider: Client.provider,
              server: endpoints,
              client: oauthClientValue,
              code: input.code,
              state: input.params.state ?? "",
              callbackUrl: input.callbackUrl,
              codeVerifier: input.codeVerifier,
              fetch,
            }),
          ),
          Effect.flatMap(issued),
        ),
      refresh: (credential) =>
        Effect.gen(function* () {
          const { refreshToken } = parseSecret(credential.secret);
          if (refreshToken === null) {
            return yield* Errors.fail(
              new Reason.Unauthenticated({
                message: "Cloudflare credential has no refresh token",
              }),
            );
          }
          const tokens = yield* OAuth.refresh({
            provider: Client.provider,
            server: endpoints,
            client: yield* oauthClient(settings),
            refreshToken,
            fetch,
          });
          return {
            secret: packSecret(tokens),
            context: credential.context,
            expiresAt: tokens.expiresAt,
          };
        }),
      revoke: (credential) =>
        Effect.gen(function* () {
          const { accessToken } = parseSecret(credential.secret);
          yield* OAuth.revoke({
            provider: Client.provider,
            server: endpoints,
            client: yield* oauthClient(settings),
            token: accessToken,
            fetch,
          });
        }),
    };
  }

  return Provider.make<AccountContext>({
    id: "cloudflare",
    name: "Cloudflare",
    nameservers: ["ns.cloudflare.com"],
    context: AccountContext,
    contextVersion: "cloudflare.v1",
    auth: {
      token: Provider.tokenAuth({
        label: "API token",
        docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
        requiredCapabilities: capabilities,
        fields: TokenFields,
        authenticate: ({ token, accountId }) =>
          Effect.gen(function* () {
            const raw = Redacted.value(token);
            if (accountId !== undefined) {
              const expiresAt = yield* Client.verifyToken(
                client(raw),
                `/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
              );
              return {
                secret: token,
                context: { accountId, tokenKind: "account" } satisfies AccountContext,
                expiresAt,
              };
            }
            const discovered = yield* discoverAccount(raw);
            const verified = yield* Client.tokenExpiry(client(raw), discovered);
            return {
              secret: token,
              context: { accountId: discovered, tokenKind: verified.kind } satisfies AccountContext,
              expiresAt: verified.expiresAt,
            };
          }),
      }),
      ...(oauth === undefined ? {} : { oauth }),
    },
    session: (credential) => {
      const { accessToken } = parseSecret(credential.secret);
      const clientOptions = client(accessToken);
      const context = Schema.decodeUnknownOption(AccountContext)(credential.context);
      const accountId =
        context._tag === "Some" ? (context.value.accountId ?? undefined) : undefined;
      const listTargets = () =>
        Client.listZones(clientOptions, accountId).pipe(Effect.map((zones) => zones.map(targetOf)));
      return {
        capabilities: () => Effect.succeed(capabilities),
        listTargets,
        resolveTarget: (domain) =>
          Effect.gen(function* () {
            const name = yield* DomainName.decode(domain);
            const targets = yield* listTargets();
            return Provider.resolveAmong(name, targets);
          }),
        dns: (target) => {
          const zone = Schema.decodeUnknownOption(AccountContext)(target.context);
          const zoneId = zone._tag === "Some" ? zone.value.zoneId : undefined;
          if (zoneId === undefined) {
            const failure = Errors.fail(
              new Reason.Unsupported({
                provider: "cloudflare",
                operation: "dns",
                message: "Cloudflare target has no zone id; only zone targets host records",
              }),
            );
            return {
              list: () => failure,
              create: () => failure,
              get: () => failure,
              delete: () => failure,
            };
          }
          return Client.dns(clientOptions, zoneId);
        },
      };
    },
  });
};
