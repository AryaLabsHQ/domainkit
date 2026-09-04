import type { Fetch } from "../../../src/internal/http.ts";
import { json } from "../recorded-fetch.ts";

export const domain = {
  id: "domain-1",
  intendedNameservers: ["ns1.vercel-dns.com", "ns2.vercel-dns.com"],
  name: "example.com",
  nameservers: ["ns1.vercel-dns.com", "ns2.vercel-dns.com"],
  serviceType: "zeit.world",
  teamId: "team-1",
  userId: "user-1",
  verified: true,
  zone: true,
} as const;

export const personalDomain = {
  ...domain,
  id: "domain-2",
  name: "personal.dev",
  teamId: null,
} as const;

export const user = { user: { id: "user-1", name: "User", username: "user" } };

export const domainPage = (domains: ReadonlyArray<unknown>, next: number | null = null) => ({
  domains,
  pagination: { count: domains.length, next, prev: null },
});

export const recordPage = (records: ReadonlyArray<unknown>, next: number | null = null) => ({
  pagination: { count: records.length, next, prev: null },
  records,
});

export const teamPage = (teams: ReadonlyArray<unknown>) => ({
  pagination: { count: teams.length, next: null, prev: null },
  teams,
});

export function record(
  type: string,
  name: string,
  value: string,
  fields: Readonly<Record<string, unknown>> = {},
) {
  return { id: `record-${type.toLowerCase()}`, name, type, value, ...fields };
}

/** Stateful Vercel API with one-record pages, for the provider conformance contract. */
export function conformanceFetch(): Fetch {
  const records = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (new Headers(init?.headers).get("authorization") !== "Bearer token") {
      return json({ error: { code: "forbidden", message: "Not authorized" } }, { status: 403 });
    }
    if (method === "GET" && url.pathname === "/v2/user") return json(user);
    if (method === "GET" && url.pathname === "/v2/teams") return json(teamPage([]));
    if (method === "GET" && url.pathname === "/v5/domains") {
      return json(domainPage(url.searchParams.get("teamId") === "team-1" ? [domain] : []));
    }
    if (method === "GET" && url.pathname === "/v5/domains/example.com/records") {
      const offset = Number(url.searchParams.get("until") ?? "0");
      const all = [...records.values()];
      const next = offset + 1 < all.length ? offset + 1 : null;
      return json(recordPage(all.slice(offset, offset + 1), next));
    }
    if (url.pathname === "/v2/domains/example.com/records" && method === "POST") {
      const id = `record-${nextId++}`;
      records.set(id, { ...(JSON.parse(String(init?.body)) as Record<string, unknown>), id });
      return json({ uid: id });
    }
    const recordPath = url.pathname.match(/^\/v2\/domains\/example\.com\/records\/([^/]+)$/);
    if (recordPath !== null && method === "DELETE") {
      records.delete(decodeURIComponent(recordPath[1] ?? ""));
      return json({});
    }
    throw new Error(`Unhandled Vercel conformance request: ${method} ${url.pathname}`);
  };
}
