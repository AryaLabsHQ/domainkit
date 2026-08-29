import { type AuthorizationLifecycle, Cloudflare, Connection, DomainName, Secret } from "domainkit";

const capabilities = ["dns:read", "dns:write"] as const;

export interface CloudflareTokenInput {
  readonly apiToken: string;
  readonly authorizedById: string;
  readonly domain: string;
  readonly ownerId: string;
  readonly repository: AuthorizationLifecycle.Repository;
}

export async function connectCloudflareToken(input: CloudflareTokenInput) {
  const domain = DomainName.parse(input.domain);
  const token = Secret.make(input.apiToken);
  const result = await Connection.start({
    authorizedById: input.authorizedById,
    grant: { _tag: "domains", domains: [domain] },
    method: Cloudflare.Auth.tokenConnectionMethod({ capabilities, domain, token }),
    ownerId: input.ownerId,
    repository: input.repository,
  });
  if (result._tag !== "Connected") {
    throw new Error("Cloudflare token connection unexpectedly requires a redirect");
  }
  const provider = Cloudflare.make({
    accountId: result.aggregate.authorization.providerAccountId,
    capabilities,
    token,
  });
  return { aggregate: result.aggregate, provider };
}
