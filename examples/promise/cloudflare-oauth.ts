import { Cloudflare, DomainName, OAuth, Secret, type Stores } from "domainkit";

const capabilities = ["dns:read", "dns:write"] as const;

export interface CloudflareOAuthInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizationStore: Stores.ProviderAuthorization;
  readonly connectionStore: Stores.Connection;
  readonly credentialStore: Stores.Credential;
  readonly domain: string;
  readonly redirectUri: string;
  readonly ownerId: string;
  readonly scopeIds: ReadonlyArray<string>;
  readonly stateStore: Stores.OAuthState;
  readonly subjectId: string;
}

export async function beginCloudflareOAuth(input: CloudflareOAuthInput) {
  const method = Cloudflare.Auth.oauthMethod({
    capabilities,
    clientAuth: "client_secret_basic",
    scopes: input.scopeIds,
  });
  return OAuth.begin({
    client: { clientId: input.clientId, clientSecret: Secret.make(input.clientSecret) },
    grant: { _tag: "account" },
    method,
    ownerId: input.ownerId,
    redirectUri: input.redirectUri,
    stateStore: input.stateStore,
    subjectId: input.subjectId,
  });
}

export async function completeCloudflareOAuth(input: CloudflareOAuthInput, callbackUrl: URL) {
  return OAuth.complete({
    callbackUrl,
    authorizationStore: input.authorizationStore,
    client: { clientId: input.clientId, clientSecret: Secret.make(input.clientSecret) },
    connectionStore: input.connectionStore,
    credentialStore: input.credentialStore,
    providerId: "cloudflare",
    resolveSubject: Cloudflare.Auth.subjectResolver({
      capabilities,
      domain: DomainName.parse(input.domain),
    }),
    stateStore: input.stateStore,
  });
}
