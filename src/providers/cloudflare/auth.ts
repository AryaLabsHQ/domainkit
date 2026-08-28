import type * as oauth from "oauth4webapi";
import { Clock, Effect } from "effect";

import type * as ProviderAuth from "../../auth/manifest.ts";
import type * as Secret from "../../auth/secret.ts";
import type * as DomainName from "../../domain/domain-name.ts";
import * as Client from "./client.ts";

const authorizationServer = {
  authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
  issuer: "https://dash.cloudflare.com",
  revocation_endpoint: "https://dash.cloudflare.com/oauth2/revoke",
  token_endpoint: "https://dash.cloudflare.com/oauth2/token",
} as const;

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
        readonly tokenKind?: "user";
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
