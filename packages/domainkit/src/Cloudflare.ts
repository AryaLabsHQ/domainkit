/** Cloudflare: personal API tokens and OAuth. */
import { type Config, Effect, Redacted, Schema } from "effect";

import * as DomainKitError from "./DomainKitError.ts";
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
  zoneId: Schema.optionalKey(Schema.String),
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
  };
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
}

export const server: OAuth.Server = {
  authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
  issuer: "https://dash.cloudflare.com",
  revocation_endpoint: "https://dash.cloudflare.com/oauth2/revoke",
  token_endpoint: "https://dash.cloudflare.com/oauth2/token",
};

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
        return accounts.size === 1 ? [...accounts][0]! : null;
      }),
    );

  const targetOf = (zone: Protocol.Zone): Provider.Target => ({
    zone: zone.name,
    context: { accountId: zone.account.id, zoneId: zone.id } satisfies AccountContext,
    label: `${zone.name} (${zone.account.name})`,
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
  ): Effect.Effect<Provider.IssuedCredential, DomainKitError.DomainKitError> =>
    discoverAccount(tokens.accessToken).pipe(
      Effect.map((accountId) => ({
        secret: packSecret(tokens),
        context: { accountId } satisfies AccountContext,
        expiresAt: tokens.expiresAt,
      })),
    );

  const oauth: Provider.OAuthAuth | undefined =
    options.oauth === undefined
      ? undefined
      : {
          label: "Sign in with Cloudflare",
          scopes: options.oauth.scopes ?? defaultScopes,
          start: (input) =>
            oauthClient(options.oauth!).pipe(
              Effect.map(({ clientId }) => ({
                authorizationUrl: OAuth.authorizationUrl({
                  server,
                  clientId,
                  scopes: options.oauth?.scopes ?? defaultScopes,
                  state: input.state,
                  callbackUrl: input.callbackUrl,
                  codeChallenge: input.codeChallenge,
                }),
              })),
            ),
          complete: (input) =>
            oauthClient(options.oauth!).pipe(
              Effect.flatMap((oauthClientValue) =>
                OAuth.exchangeCode({
                  provider: Client.provider,
                  server,
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
                return yield* DomainKitError.fail(
                  new DomainKitError.Unauthenticated({
                    message: "Cloudflare credential has no refresh token",
                  }),
                );
              }
              const tokens = yield* OAuth.refresh({
                provider: Client.provider,
                server,
                client: yield* oauthClient(options.oauth!),
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
                server,
                client: yield* oauthClient(options.oauth!),
                token: accessToken,
                fetch,
              });
            }),
        };

  return Provider.make<AccountContext>({
    id: "cloudflare",
    name: "Cloudflare",
    context: AccountContext,
    auth: {
      token: {
        label: "API token",
        docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
        requiredCapabilities: capabilities,
        authenticate: (token) =>
          Effect.gen(function* () {
            const raw = Redacted.value(token);
            const accountId = yield* discoverAccount(raw);
            const expiresAt = yield* Client.tokenExpiry(client(raw), accountId);
            return { secret: token, context: { accountId } satisfies AccountContext, expiresAt };
          }),
      },
      ...(oauth === undefined ? {} : { oauth }),
    },
    session: (credential) => {
      const { accessToken } = parseSecret(credential.secret);
      const options = client(accessToken);
      const context = Schema.decodeUnknownOption(AccountContext)(credential.context);
      const accountId =
        context._tag === "Some" ? (context.value.accountId ?? undefined) : undefined;
      const listTargets = () =>
        Client.listZones(options, accountId).pipe(Effect.map((zones) => zones.map(targetOf)));
      return {
        capabilities: () => Effect.succeed(capabilities),
        listTargets,
        resolveTarget: (domain) =>
          Effect.gen(function* () {
            const name = yield* DomainName.decode(domain);
            const targets = yield* listTargets();
            for (const candidate of DomainName.candidates(name)) {
              const matches = targets.filter((target) => target.zone === candidate);
              if (matches.length === 1) return { _tag: "Resolved", target: matches[0]! } as const;
              if (matches.length > 1)
                return { _tag: "SelectionRequired", candidates: matches } as const;
            }
            return { _tag: "NotFound" } as const;
          }),
        dns: (target) => {
          const zone = Schema.decodeUnknownOption(AccountContext)(target.context);
          const zoneId = zone._tag === "Some" ? zone.value.zoneId : undefined;
          if (zoneId === undefined) {
            const failure = DomainKitError.fail(
              new DomainKitError.InvalidInput({
                message: "Cloudflare target has no zoneId",
                field: "target",
              }),
            );
            return {
              list: () => failure,
              create: () => failure,
              get: () => failure,
              delete: () => failure,
            };
          }
          return Client.dns(options, zoneId);
        },
      };
    },
  });
};
