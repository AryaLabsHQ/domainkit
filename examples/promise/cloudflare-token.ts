import {
  Cloudflare,
  Connection,
  DomainName,
  Secret,
  type Stores,
  TokenConnection,
} from "domainkit";

export interface CloudflareTokenInput {
  readonly accountId: string;
  readonly apiToken: string;
  readonly connectionStore: Stores.Connection;
  readonly credentialStore: Stores.Credential;
  readonly subjectId: string;
}

export async function connectCloudflareToken(input: CloudflareTokenInput) {
  const provider = Cloudflare.make({
    accountId: input.accountId,
    capabilities: ["dns:read", "dns:write"],
    token: Secret.make(input.apiToken),
  });
  const grant: Connection.Grant = {
    _tag: "domains",
    domains: [DomainName.parse("example.com")],
  };
  const connection = await TokenConnection.connect({
    connectionStore: input.connectionStore,
    credentialStore: input.credentialStore,
    grant,
    providerId: provider.id,
    subjectId: input.subjectId,
    token: Secret.make(input.apiToken),
    validate: (token) =>
      Cloudflare.make({
        accountId: input.accountId,
        capabilities: ["dns:read", "dns:write"],
        token,
      }).validateToken(),
  });
  return { connection, provider };
}
