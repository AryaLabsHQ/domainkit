import { type ManagedDnsConnections, Cloudflare, Connection, Secret } from "domainkit/promise";

const capabilities = ["dns:read", "dns:write"] as const;

export interface CloudflareTokenInput {
  readonly accountId: string;
  readonly apiToken: string;
  readonly authorizedById: string;
  readonly ownerId: string;
  readonly repository: ManagedDnsConnections.AsyncInterface;
}

/** Connects an organization and returns its public connection plus an account-scoped client. */
export async function connectCloudflareToken(input: CloudflareTokenInput) {
  const token = Secret.make(input.apiToken);
  const result = await Connection.start({
    authorizedById: input.authorizedById,
    method: Cloudflare.Auth.tokenConnectionMethod({
      accountId: input.accountId,
      capabilities,
      token,
    }),
    ownerId: input.ownerId,
    repository: input.repository,
  });
  if (result._tag !== "Connected") {
    throw new Error("Cloudflare token connection unexpectedly requires a redirect");
  }
  const provider = Cloudflare.make({
    accountId: input.accountId,
    capabilities,
    token,
  });
  return { connection: result.connection, provider };
}
