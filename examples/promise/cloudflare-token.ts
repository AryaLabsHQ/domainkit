import {
  Cloudflare,
  Connection,
  DomainName,
  Secret,
  type Stores,
  TokenConnection,
} from "domainkit";

export interface CloudflareTokenInput {
  readonly apiToken: string;
  readonly authorizationStore: Stores.ProviderAuthorization;
  readonly connectionStore: Stores.Connection;
  readonly credentialStore: Stores.Credential;
  readonly domain: string;
  readonly ownerId: string;
  readonly subjectId: string;
}

export async function connectCloudflareToken(input: CloudflareTokenInput) {
  const domain = DomainName.parse(input.domain);
  const grant: Connection.Grant = {
    _tag: "domains",
    domains: [domain],
  };
  const result = await TokenConnection.connect({
    authorizationStore: input.authorizationStore,
    connectionStore: input.connectionStore,
    credentialStore: input.credentialStore,
    grant,
    ownerId: input.ownerId,
    providerId: "cloudflare",
    subjectId: input.subjectId,
    token: Secret.make(input.apiToken),
    validate: Cloudflare.Auth.tokenValidator({
      capabilities: ["dns:read", "dns:write"],
      domain,
    }),
  });
  const provider = Cloudflare.make({
    accountId: result.authorization.accountId,
    capabilities: ["dns:read", "dns:write"],
    token: Secret.make(input.apiToken),
  });
  return { ...result, provider };
}
