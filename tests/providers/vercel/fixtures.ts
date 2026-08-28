import type { Fetch } from "../../../src/providers/vercel/client.ts";
import { DomainName } from "../../../src/effect.ts";

export const domain = {
  id: "domain-1",
  intendedNameservers: ["ns1.vercel-dns.com", "ns2.vercel-dns.com"],
  name: "example.com",
  nameservers: ["ns1.vercel-dns.com", "ns2.vercel-dns.com"],
  serviceType: "zeit.world",
  teamId: "team-1",
  userId: "user-1",
  verified: true,
} as const;

export const portableZone = {
  accountId: "team-1",
  id: "domain-1",
  name: DomainName.parse("example.com"),
  nameservers: [DomainName.parse("ns1.vercel-dns.com"), DomainName.parse("ns2.vercel-dns.com")],
  status: "active",
} as const;

export const pagination = (next: number | null = null) => ({ count: 1, next, prev: null });

export const domainPage = (domains: ReadonlyArray<unknown>, next: number | null = null) => ({
  domains,
  pagination: { count: domains.length, next, prev: null },
});

export const recordPage = (records: ReadonlyArray<unknown>, next: number | null = null) => ({
  pagination: { count: records.length, next, prev: null },
  records,
});

export const authoritativeConfig = {
  // Vercel uses this flag for project traffic routing, not DNS authority.
  misconfigured: true,
  serviceType: "zeit.world",
} as const;

export const domainEnvelope = { domain } as const;

export function record(
  type: string,
  name: string,
  value: string,
  fields: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return { id: `record-${type.toLowerCase()}`, name, type, value, ...fields };
}

export interface RecordedRequest {
  readonly init: RequestInit | undefined;
  readonly url: string;
}

export function recordedFetch(
  responses: ReadonlyArray<{
    readonly body: unknown;
    readonly expect?: { readonly method?: string; readonly pathname: string };
    readonly init?: ResponseInit;
    readonly json?: boolean;
  }>,
): { readonly fetch: Fetch; readonly requests: Array<RecordedRequest> } {
  const requests: Array<RecordedRequest> = [];
  let index = 0;
  return {
    requests,
    fetch: async (input, init) => {
      requests.push({ init, url: String(input) });
      const response = responses[index++];
      if (response === undefined) throw new Error("No recorded Vercel response remains");
      if (response.expect !== undefined) {
        const actualUrl = new URL(String(input));
        const actualMethod = init?.method ?? "GET";
        if (
          actualMethod !== (response.expect.method ?? "GET") ||
          actualUrl.pathname !== response.expect.pathname
        ) {
          throw new Error(
            `Expected ${response.expect.method ?? "GET"} ${response.expect.pathname}, received ${actualMethod} ${actualUrl.pathname}`,
          );
        }
      }
      return new Response(
        response.json === false ? String(response.body) : JSON.stringify(response.body),
        {
          headers: { "content-type": "application/json", ...response.init?.headers },
          ...response.init,
        },
      );
    },
  };
}
