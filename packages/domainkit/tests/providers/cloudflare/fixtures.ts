import type { Fetch } from "../../../src/internal/http.ts";
import { json } from "../recorded-fetch.ts";

export const zone = {
  account: { id: "account-1", name: "Example Account" },
  id: "zone-1",
  name: "example.com",
  name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  status: "active",
  type: "full",
} as const;

export function page<T>(result: ReadonlyArray<T>, current = 1, total = 1): unknown {
  return {
    errors: [],
    messages: [],
    result,
    result_info: {
      count: result.length,
      page: current,
      per_page: 50,
      total_count: result.length,
      total_pages: total,
    },
    success: true,
  };
}

export function single<T>(result: T): unknown {
  return { errors: [], messages: [], result, success: true };
}

export const failure = (code: number, message: string) => ({
  errors: [{ code, message }],
  messages: [],
  result: null,
  success: false,
});

export const activeToken = single({
  id: "token-1",
  status: "active",
  expires_on: "2030-01-01T00:00:00Z",
});

/** Stateful Cloudflare API with one-record pages, for the provider conformance contract. */
export function conformanceFetch(): Fetch {
  const records = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === "/client/v4/zones") return json(page([zone]));
    if (method === "GET" && url.pathname === "/client/v4/user/tokens/verify")
      return json(activeToken);
    const recordPath = url.pathname.match(/^\/client\/v4\/zones\/zone-1\/dns_records\/([^/]+)$/);
    if (recordPath !== null) {
      const id = decodeURIComponent(recordPath[1] ?? "");
      if (method === "GET") {
        const record = records.get(id);
        return record === undefined
          ? json(failure(81044, "Record does not exist."), { status: 404 })
          : json(single(record));
      }
      if (method === "DELETE") {
        records.delete(id);
        return json(single({ id }));
      }
    }
    if (url.pathname === "/client/v4/zones/zone-1/dns_records") {
      if (method === "POST") {
        const id = `record-${nextId++}`;
        const record = { ...(JSON.parse(String(init?.body)) as Record<string, unknown>), id };
        records.set(id, record);
        return json(single(record));
      }
      if (method === "GET") {
        const current = Number(url.searchParams.get("page") ?? "1");
        const all = [...records.values()];
        const total = Math.max(1, all.length);
        return json(page(all.slice(current - 1, current), current, total));
      }
    }
    throw new Error(`Unhandled Cloudflare conformance request: ${method} ${url.pathname}`);
  };
}
