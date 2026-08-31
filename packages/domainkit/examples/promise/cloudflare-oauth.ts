import {
  type ManagedDnsConnections,
  Cloudflare,
  Connection,
  DomainName,
  Secret,
} from "domainkit/promise";

const capabilities = ["dns:read", "dns:write"] as const;

export interface CloudflareOAuthInput {
  readonly authorizedById: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly continuations: Connection.ContinuationStore;
  readonly domain: string;
  readonly ownerId: string;
  readonly redirectUri: string;
  readonly repository: ManagedDnsConnections.AsyncInterface;
  readonly scopeIds: ReadonlyArray<string>;
}

function flow(input: CloudflareOAuthInput): Connection.InteractiveFlow {
  return Cloudflare.Auth.oauthFlow({
    capabilities,
    client: {
      clientId: input.clientId,
      clientSecret: Secret.make(input.clientSecret),
    },
    clientAuth: "client_secret_basic",
    domain: DomainName.parse(input.domain),
    redirectUri: input.redirectUri,
    scopes: input.scopeIds,
  });
}

export function beginCloudflareOAuth(input: CloudflareOAuthInput) {
  const oauth = flow(input);
  return Connection.start({
    authorizedById: input.authorizedById,
    method: Connection.Method.Interactive({
      continuations: input.continuations,
      flow: oauth,
    }),
    ownerId: input.ownerId,
    repository: input.repository,
  });
}

export function completeCloudflareOAuth(
  input: CloudflareOAuthInput,
  continuationId: string,
  callbackUrl: URL,
) {
  return Connection.complete({
    callbackUrl,
    continuationId,
    continuations: input.continuations,
    flow: flow(input),
    repository: input.repository,
  });
}
