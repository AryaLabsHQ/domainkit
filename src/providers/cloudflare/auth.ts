import type * as oauth from "oauth4webapi";
import { Clock, Effect } from "effect";

import type * as ProviderAuth from "../../auth/manifest.ts";
import type * as Secret from "../../auth/secret.ts";
import * as Client from "./client.ts";

const authorizationServer = {
  authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
  issuer: "https://dash.cloudflare.com",
  revocation_endpoint: "https://dash.cloudflare.com/oauth2/revoke",
  token_endpoint: "https://dash.cloudflare.com/oauth2/token",
} as const;

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

export function oauthMethod(options: OAuthMethodOptions): ProviderAuth.OAuthMethod {
  return {
    _tag: "oauth2",
    authorizationServer,
    capabilities: [...options.capabilities],
    clientAuth: options.clientAuth,
    scopes: [...options.scopes],
  };
}

export function manifest(options: OAuthMethodOptions): ProviderAuth.Manifest {
  return {
    methods: [tokenMethod(options.capabilities), oauthMethod(options)],
    providerId: "cloudflare",
  };
}

export interface SubjectResolverOptions extends Omit<Client.Options, "token" | "tokenKind"> {}

export function subjectResolver(
  options: SubjectResolverOptions,
): ProviderAuth.OAuthSubjectResolver {
  return (tokens: oauth.TokenEndpointResponse, accessToken: Secret.Value) =>
    Effect.gen(function* () {
      const client = Client.make({ ...options, token: accessToken, tokenKind: "user" });
      yield* client.listZones();
      const now = yield* Clock.currentTimeMillis;
      return {
        accountId: options.accountId,
        expiresAt:
          typeof tokens.expires_in === "number" ? new Date(now + tokens.expires_in * 1_000) : null,
      };
    });
}

export function tokenValidator(
  options: Omit<Client.Options, "token">,
): (token: Secret.Value) => ReturnType<Client.Interface["validateToken"]> {
  return (token) => Client.make({ ...options, token }).validateToken();
}
