import * as oauth from "oauth4webapi";
import { Clock, Effect, Schema } from "effect";

import * as AuthorizationCode from "../../auth/authorization-code.ts";
import * as Connection from "../../auth/connect.ts";
import * as ProviderAuthorization from "../../auth/authorization.ts";
import * as ProviderAuth from "../../auth/manifest.ts";
import * as ProviderContext from "../../auth/provider-context.ts";
import * as Secret from "../../auth/secret.ts";
import type * as DomainName from "../../domain/domain-name.ts";
import * as DnsProvider from "../../provider/provider.ts";
import * as Client from "./client.ts";
import * as ProviderSession from "../../provider/session.ts";

const authorizationServer = {
  authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
  issuer: "https://dash.cloudflare.com",
  revocation_endpoint: "https://dash.cloudflare.com/oauth2/revoke",
  token_endpoint: "https://dash.cloudflare.com/oauth2/token",
} as const;

const Context = Schema.Struct({
  accountId: Schema.optionalKey(Schema.String),
  tokenKind: Schema.Literals(["account", "user"]),
});
export type Context = typeof Context.Type;
export const contextCodec = ProviderContext.codec("cloudflare.v1", Context);

/** Describes Cloudflare's caller-created API-token authorization method. */
export function tokenMethod(
  capabilities: ProviderAuth.TokenValidation["capabilities"],
): Extract<ProviderAuth.Manifest["methods"][number], { readonly _tag: "token" }> {
  return ProviderAuth.Method.token({
    capabilities: [...capabilities],
    instructionsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
  });
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
  return ProviderAuth.Method.oauth2({
    authorizationServer,
    capabilities: [...options.capabilities],
    clientAuth: options.clientAuth,
    scopes: [...options.scopes],
  });
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

/** Resolves the Cloudflare account selected by a completed OAuth authorization. */
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
        credential: {
          accessToken: token,
          expiresAt: validated.expiresAt,
          refreshToken: null,
          tokenType: "bearer",
        },
        providerAccountId: validated.accountId,
        providerContext: yield* contextCodec.encode(
          options.tokenKind === "account"
            ? { accountId: validated.accountId, tokenKind: "account" }
            : { tokenKind: "user" },
        ),
        scopes: [...validated.scopes],
      } satisfies Connection.Authentication;
    }),
    providerId: "cloudflare",
    requiredCapabilities,
    token: options.token,
  });
}

/** Converts a completed Cloudflare OAuth authorization into canonical connection authentication. */
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
      expiresAt: resolved.expiresAt,
      refreshToken:
        options.tokens.refresh_token === undefined
          ? null
          : Secret.Value.from(options.tokens.refresh_token),
      tokenType: options.tokens.token_type,
    },
    providerAccountId: resolved.accountId,
    providerContext: yield* contextCodec.encode({ tokenKind: "user" }),
    scopes: (options.tokens.scope ?? "").split(" ").filter(Boolean),
  } satisfies Connection.Authentication;
});

/** Restore a credential-scoped Cloudflare session from persisted authorization state. */
export function restore(
  options: ProviderSession.RestoreInput & Pick<Client.Options, "baseUrl" | "fetch">,
): Effect.Effect<Client.Interface, DnsProvider.Error> {
  return Effect.gen(function* () {
    if (options.authorization.providerId !== "cloudflare") {
      return yield* Effect.fail(
        failure("restore", "Provider authorization belongs to another provider", "authorization"),
      );
    }
    if (options.authorization.method === "integration") {
      return yield* Effect.fail(
        failure("restore", "Cloudflare does not support integration credentials", "unsupported"),
      );
    }
    if (options.authorization.revocation._tag !== "Active") {
      return yield* Effect.fail(
        failure("restore", "Cloudflare authorization is pending revocation", "authorization"),
      );
    }
    const missingCapability = options.authorization.requiredCapabilities.find(
      (capability) =>
        !options.authorization.capabilityEvidence.some((item) => item.capability === capability),
    );
    if (missingCapability !== undefined) {
      return yield* Effect.fail(
        failure(
          "restore",
          `Cloudflare authorization lacks evidence for ${missingCapability}`,
          "authorization",
        ),
      );
    }
    if (
      options.credential.expiresAt !== null &&
      (Number.isNaN(options.credential.expiresAt.valueOf()) ||
        options.credential.expiresAt <= new Date())
    ) {
      return yield* Effect.fail(
        failure("restore", "Cloudflare authorization has expired", "authentication"),
      );
    }
    const context = yield* contextCodec
      .decode(options.authorization.providerContext)
      .pipe(Effect.mapError((cause) => failure("restore", cause.message, "response")));
    return Client.make({
      ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      capabilities: options.authorization.capabilityEvidence.map(({ capability }) => capability),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      token: options.credential.accessToken,
      tokenKind: context.tokenKind,
    });
  });
}

export interface RefreshCredentialOptions {
  readonly client: ProviderAuth.OAuthClientConfiguration;
  readonly clientAuth: ProviderAuth.OAuthMethod["clientAuth"];
  readonly credential: ProviderSession.Credential;
  readonly fetch?: Client.Fetch;
}

/** Exchanges a Cloudflare refresh token for a fresh provider credential. */
export const refreshCredential = Effect.fn("CloudflareAuth.refreshCredential")(function* (
  options: RefreshCredentialOptions,
) {
  if (options.credential.refreshToken === null) {
    return yield* new Connection.Error({
      category: "authorization",
      message: "Cloudflare credential has no refresh token",
      operation: "CloudflareAuth.refreshCredential",
      retry: "after-user-action",
    });
  }
  const refreshToken = options.credential.refreshToken;
  const client: oauth.Client = { client_id: options.client.clientId };
  const authentication = yield* Effect.try({
    try: () => clientAuthentication(options.clientAuth, options.client),
    catch: () =>
      new Connection.Error({
        category: "authorization",
        message: "Cloudflare OAuth client authentication is invalid",
        operation: "CloudflareAuth.refreshCredential",
        retry: "never",
      }),
  });
  const fetch = options.fetch;
  const tokens = yield* Effect.tryPromise({
    try: async (signal) => {
      const request = await oauth.refreshTokenGrantRequest(
        authorizationServer,
        client,
        authentication,
        refreshToken.expose(),
        fetch === undefined
          ? { signal }
          : {
              signal,
              [oauth.customFetch]: (url, init) => fetch(url, { ...init, body: init.body }),
            },
      );
      return oauth.processRefreshTokenResponse(authorizationServer, client, request);
    },
    catch: (cause) => refreshFailure(cause),
  });
  const now = yield* Clock.currentTimeMillis;
  return {
    accessToken: Secret.Value.from(tokens.access_token),
    expiresAt:
      typeof tokens.expires_in === "number" ? new Date(now + tokens.expires_in * 1_000) : null,
    refreshToken:
      tokens.refresh_token === undefined ? refreshToken : Secret.Value.from(tokens.refresh_token),
    tokenType: tokens.token_type,
  } satisfies ProviderSession.Credential;
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

function failure(
  operation: string,
  message: string,
  reason: DnsProvider.ErrorReason,
): DnsProvider.Error {
  return new DnsProvider.Error({ message, operation, providerId: "cloudflare", reason });
}

function clientAuthentication(
  method: ProviderAuth.OAuthMethod["clientAuth"],
  client: ProviderAuth.OAuthClientConfiguration,
): oauth.ClientAuth {
  if (method === "none") return oauth.None();
  if (client.clientSecret === undefined) throw new Error("Client secret is required");
  return method === "client_secret_basic"
    ? oauth.ClientSecretBasic(client.clientSecret.expose())
    : oauth.ClientSecretPost(client.clientSecret.expose());
}

function refreshFailure(cause: unknown): Connection.Error | DnsProvider.Error {
  if (
    cause instanceof oauth.ResponseBodyError &&
    ["invalid_client", "invalid_grant"].includes(cause.error)
  ) {
    return new Connection.Error({
      category: "authorization",
      message: "Cloudflare authorization can no longer be refreshed",
      operation: "CloudflareAuth.refreshCredential",
      retry: "after-user-action",
    });
  }
  return failure(
    "refreshCredential",
    cause instanceof Error ? cause.message : "Cloudflare token refresh failed",
    cause instanceof oauth.ResponseBodyError ? "response" : "transport",
  );
}
