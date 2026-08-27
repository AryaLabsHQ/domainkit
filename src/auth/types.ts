import { Schema } from "effect";
import type * as oauth from "oauth4webapi";

import { DomainName } from "../domain/domain-name.ts";
import type { Secret } from "./secret.ts";

export const ConnectionCapability = Schema.Literals(["dns:read", "dns:write"]);
export type ConnectionCapability = typeof ConnectionCapability.Type;

export const ConnectionGrant = Schema.Union([
  Schema.TaggedStruct("account", {}),
  Schema.TaggedStruct("domains", { domains: Schema.Array(DomainName) }),
]);
export type ConnectionGrant = typeof ConnectionGrant.Type;

export const ProviderAuthManifest = Schema.Struct({
  methods: Schema.Array(
    Schema.Union([
      Schema.TaggedStruct("oauth2", {
        authorizationServer: Schema.Struct({
          authorization_endpoint: Schema.String,
          issuer: Schema.String,
          revocation_endpoint: Schema.optionalKey(Schema.String),
          token_endpoint: Schema.String,
        }),
        capabilities: Schema.Array(ConnectionCapability),
        clientAuth: Schema.Literals(["none", "client_secret_basic", "client_secret_post"]),
        scopes: Schema.Array(Schema.String),
      }),
      Schema.TaggedStruct("token", {
        capabilities: Schema.Array(ConnectionCapability),
        instructionsUrl: Schema.String,
      }),
    ]),
  ),
  providerId: Schema.String,
});
export type ProviderAuthManifest = typeof ProviderAuthManifest.Type;
export type OAuthMethod = Extract<
  ProviderAuthManifest["methods"][number],
  { readonly _tag: "oauth2" }
>;

export const Connection = Schema.Struct({
  accountId: Schema.String,
  capabilities: Schema.Array(ConnectionCapability),
  createdAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  grant: ConnectionGrant,
  id: Schema.String,
  kind: Schema.Literals(["oauth2", "token"]),
  providerId: Schema.String,
  scopes: Schema.Array(Schema.String),
  subjectId: Schema.String,
});
export type Connection = typeof Connection.Type;

export interface OAuthContinuation {
  readonly clientId: string;
  readonly codeVerifier: Secret;
  readonly expiresAt: string;
  readonly grant: ConnectionGrant;
  readonly method: OAuthMethod;
  readonly redirectUri: string;
  readonly stateHash: string;
  readonly subjectId: string;
}

export interface StoredCredential {
  readonly accessToken: Secret;
  readonly refreshToken: Secret | null;
  readonly tokenType: string;
}

export interface OAuthClientConfiguration {
  readonly clientId: string;
  readonly clientSecret?: Secret;
}

export interface TokenValidation {
  readonly accountId: string;
  readonly capabilities: ReadonlyArray<ConnectionCapability>;
  readonly expiresAt: string | null;
  readonly scopes: ReadonlyArray<string>;
}

export interface OAuthSubjectResolver {
  (
    tokens: oauth.TokenEndpointResponse,
    accessToken: Secret,
  ): Promise<{ readonly accountId: string; readonly expiresAt: string | null }>;
}
