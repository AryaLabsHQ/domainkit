import type * as oauth from "oauth4webapi";
import { Clock, Effect, Schema } from "effect";

import * as AuthorizationCode from "../../auth/authorization-code.ts";
import * as Connection from "../../auth/connect.ts";
import * as ProviderAuthorization from "../../auth/authorization.ts";
import type * as ProviderAuth from "../../auth/manifest.ts";
import * as ProviderContext from "../../auth/provider-context.ts";
import * as Secret from "../../auth/secret.ts";
import type * as DomainName from "../../domain/domain-name.ts";
import * as Client from "./client.ts";

const authorizationServer = {
  authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
  issuer: "https://dash.cloudflare.com",
  revocation_endpoint: "https://dash.cloudflare.com/oauth2/revoke",
  token_endpoint: "https://dash.cloudflare.com/oauth2/token",
} as const;

const Context = Schema.Struct({ tokenKind: Schema.Literals(["account", "user"]) });
export type Context = typeof Context.Type;
export const contextCodec = ProviderContext.codec("cloudflare.v1", Context);

/** Describes Cloudflare's caller-created API-token authorization method. */
export function tokenMethod(
  capabilities: ProviderAuth.TokenValidation["capabilities"],
): Extract<ProviderAuth.Manifest["methods"][number], { readonly _tag: "token" }> {
  return {
    _tag: "token",
    capabilities: [...capabilities],
    instructionsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
  };
}

export interface OAuthMethodOptions {
  /** Scope IDs assigned to the OAuth client by Cloudflare. */
  readonly scopes: ReadonlyArray<string>;
  /** Capabilities represented by those assigned scope IDs. */
  readonly capabilities: ProviderAuth.TokenValidation["capabilities"];
  readonly clientAuth: ProviderAuth.OAuthMethod["clientAuth"];
}

/** Describes a registered Cloudflare OAuth client and its assigned scope IDs. */
export function oauthMethod(options: OAuthMethodOptions): ProviderAuth.OAuthMethod {
  return {
    _tag: "oauth2",
    authorizationServer,
    capabilities: [...options.capabilities],
    clientAuth: options.clientAuth,
    scopes: [...options.scopes],
  };
}

/** Creates the Cloudflare token and OAuth authorization manifest. */
export function manifest(options: OAuthMethodOptions): ProviderAuth.Manifest {
  return {
    methods: [tokenMethod(options.capabilities), oauthMethod(options)],
    providerId: "cloudflare",
  };
}

type CredentialOptions = Omit<Client.Options, "accountId" | "token" | "tokenKind">;

/** Selects an explicit Cloudflare account or discovers it from an authorized domain. */
export type CredentialTarget =
  | {
      readonly accountId: string;
      readonly domain?: never;
    }
  | {
      readonly accountId?: never;
      readonly domain: DomainName.DomainName;
    };

export type SubjectResolverOptions = CredentialOptions & CredentialTarget;

/** Configuration for validating a Cloudflare token against an account or authorized domain. */
export type TokenValidatorOptions = CredentialOptions &
  (
    | {
        readonly accountId: string;
        readonly domain?: never;
        readonly tokenKind?: "account" | "user";
      }
    | {
        readonly accountId?: never;
        readonly domain: DomainName.DomainName;
        readonly tokenKind?: "account" | "user";
      }
  );

/** Resolves the Cloudflare account selected by a completed OAuth grant. */
export function subjectResolver(
  options: SubjectResolverOptions,
): ProviderAuth.OAuthSubjectResolver {
  return (tokens: oauth.TokenEndpointResponse, accessToken: Secret.Value) =>
    Effect.gen(function* () {
      const accountId =
        options.accountId ??
        (yield* Client.discoverAuthorizationAccount({
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          domain: options.domain,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          token: accessToken,
        }).pipe(Effect.map((account) => account.id)));
      if (options.accountId !== undefined) {
        yield* Client.make({
          accountId: options.accountId,
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          capabilities: options.capabilities,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          token: accessToken,
          tokenKind: "user",
        }).listZones();
      }
      const now = yield* Clock.currentTimeMillis;
      return {
        accountId,
        expiresAt:
          typeof tokens.expires_in === "number" ? new Date(now + tokens.expires_in * 1_000) : null,
      };
    });
}

/** Creates a host callback that validates a Cloudflare API token. */
export function tokenValidator(
  options: TokenValidatorOptions,
): (token: Secret.Value) => ReturnType<Client.Interface["validateToken"]> {
  return (token) =>
    options.accountId === undefined
      ? Client.validateDomainToken({
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          capabilities: options.capabilities,
          domain: options.domain,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          token,
          ...(options.tokenKind === undefined ? {} : { tokenKind: options.tokenKind }),
        })
      : Client.make({
          accountId: options.accountId,
          ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
          capabilities: options.capabilities,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          token,
          ...(options.tokenKind === undefined ? {} : { tokenKind: options.tokenKind }),
        }).validateToken();
}

export type TokenConnectionOptions = TokenValidatorOptions & {
  readonly token: Secret.Value;
};

/** Creates a provider-independent token connection method backed by Cloudflare validation. */
export function tokenConnectionMethod(
  options: TokenConnectionOptions,
): Extract<Connection.Method, { readonly _tag: "Token" }> {
  const requiredCapabilities = [...options.capabilities];
  return Connection.Method.Token({
    authenticate: Effect.fn("CloudflareAuth.authenticateToken")(function* (token) {
      const validated = yield* tokenValidator(options)(token);
      const observedAt = new Date(yield* Clock.currentTimeMillis);
      return {
        capabilityEvidence: validated.capabilities.map((capability) => ({
          capability,
          evidence: ProviderAuthorization.Evidence.Introspected({ observedAt }),
        })),
        credential: { accessToken: token, refreshToken: null, tokenType: "bearer" },
        expiresAt: validated.expiresAt,
        providerAccountId: validated.accountId,
        providerContext: yield* contextCodec.encode({ tokenKind: options.tokenKind ?? "user" }),
        scopes: [...validated.scopes],
      } satisfies Connection.Authentication;
    }),
    providerId: "cloudflare",
    requiredCapabilities,
    token: options.token,
  });
}

/** Converts a completed Cloudflare OAuth grant into the canonical connection authentication. */
export const oauthAuthentication = Effect.fn("CloudflareAuth.oauthAuthentication")(function* (
  options: SubjectResolverOptions & {
    readonly accessToken: Secret.Value;
    readonly tokens: oauth.TokenEndpointResponse;
  },
) {
  const resolved = yield* subjectResolver(options)(options.tokens, options.accessToken);
  const observedAt = new Date(yield* Clock.currentTimeMillis);
  return {
    capabilityEvidence: options.capabilities.map((capability) => ({
      capability,
      evidence: ProviderAuthorization.Evidence.Introspected({ observedAt }),
    })),
    credential: {
      accessToken: options.accessToken,
      refreshToken:
        options.tokens.refresh_token === undefined
          ? null
          : Secret.Value.from(options.tokens.refresh_token),
      tokenType: options.tokens.token_type,
    },
    expiresAt: resolved.expiresAt,
    providerAccountId: resolved.accountId,
    providerContext: yield* contextCodec.encode({ tokenKind: "user" }),
    scopes: (options.tokens.scope ?? "").split(" ").filter(Boolean),
  } satisfies Connection.Authentication;
});

export type OAuthFlowOptions = SubjectResolverOptions & {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly clientAuth: ProviderAuth.OAuthMethod["clientAuth"];
  readonly redirectUri: string;
  readonly scopes: ReadonlyArray<string>;
};

/** Creates Cloudflare's OAuth implementation of the common interactive connection capability. */
export function oauthFlow(options: OAuthFlowOptions): Connection.InteractiveFlow {
  const method = oauthMethod({
    capabilities: options.capabilities,
    clientAuth: options.clientAuth,
    scopes: options.scopes,
  });
  return {
    complete: Effect.fn("CloudflareAuth.oauthFlow.complete")(function* (payload, callbackUrl) {
      const tokens = yield* AuthorizationCode.complete({
        callbackUrl,
        client: options.client,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        method,
        payload,
        providerId: "cloudflare",
      });
      return yield* oauthAuthentication({
        ...(options.accountId === undefined
          ? { domain: options.domain }
          : { accountId: options.accountId }),
        ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
        capabilities: options.capabilities,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        accessToken: Secret.make(tokens.access_token),
        tokens,
      });
    }),
    method: "oauth2",
    providerId: "cloudflare",
    requiredCapabilities: [...options.capabilities],
    start: (continuationId) =>
      AuthorizationCode.start({
        client: options.client,
        method,
        redirectUri: options.redirectUri,
        state: continuationId,
      }),
  };
}
