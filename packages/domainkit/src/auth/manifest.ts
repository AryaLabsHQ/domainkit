import { Effect, Schema as S } from "effect";
import type * as oauth from "oauth4webapi";

import type * as DnsProvider from "../provider/provider.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import type { Value as Secret } from "./secret.ts";

export const Method = S.TaggedUnion({
  integration: {
    capabilities: S.Array(S.Literals(["dns:read", "dns:write"])),
    installUrl: S.String,
    tokenEndpoint: S.String,
  },
  oauth2: {
    authorizationServer: S.Struct({
      authorization_endpoint: S.String,
      issuer: S.String,
      revocation_endpoint: S.optionalKey(S.String),
      token_endpoint: S.String,
    }),
    capabilities: S.Array(S.Literals(["dns:read", "dns:write"])),
    clientAuth: S.Literals(["none", "client_secret_basic", "client_secret_post"]),
    scopes: S.Array(S.String),
  },
  token: {
    capabilities: S.Array(S.Literals(["dns:read", "dns:write"])),
    instructionsUrl: S.String,
  },
});

export const Schema = S.Struct({
  methods: S.Array(Method),
  providerId: S.String,
});
export interface Manifest extends S.Schema.Type<typeof Schema> {}
export type OAuthMethod = Extract<Manifest["methods"][number], { readonly _tag: "oauth2" }>;
/** A provider-owned installation flow that returns a credential from a one-time code. */
export type IntegrationMethod = Extract<
  Manifest["methods"][number],
  { readonly _tag: "integration" }
>;

export const decode = Effect.fn("ProviderAuth.decode")((input: unknown) =>
  S.decodeUnknownEffect(Schema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export interface OAuthClientConfiguration {
  readonly clientId: string;
  readonly clientSecret?: Secret;
}

export interface TokenValidation {
  readonly accountId: string;
  readonly capabilities: ReadonlyArray<"dns:read" | "dns:write">;
  readonly expiresAt: Date | null;
  readonly scopes: ReadonlyArray<string>;
}

export interface OAuthSubjectResolver {
  (
    tokens: oauth.TokenEndpointResponse,
    accessToken: Secret,
  ): Effect.Effect<
    { readonly accountId: string; readonly expiresAt: Date | null },
    DnsProvider.Error
  >;
}

export interface AsyncOAuthSubjectResolver {
  (
    tokens: oauth.TokenEndpointResponse,
    accessToken: Secret,
  ): Promise<{ readonly accountId: string; readonly expiresAt: Date | null }>;
}
