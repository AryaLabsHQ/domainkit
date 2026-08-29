import type { Fetch } from "../../../src/providers/cloudflare/client.ts";
import { DomainName } from "../../../src/effect.ts";

export const zone = {
  account: { id: "account-1", name: "Example Account" },
  id: "zone-1",
  name: "example.com",
  name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  status: "active",
} as const;

export const portableZone = {
  accountId: "account-1",
  id: "zone-1",
  name: DomainName.parse("example.com"),
  nameservers: [
    DomainName.parse("ada.ns.cloudflare.com"),
    DomainName.parse("bob.ns.cloudflare.com"),
  ],
  status: "active",
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
      if (response === undefined) throw new Error("No recorded Cloudflare response remains");
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

/** Stateful Cloudflare API fixture with one-record pages for the shared conformance contract. */
export function conformanceFetch(): Fetch {
  const records = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === "/client/v4/zones") {
      return json(page([zone]));
    }
    const recordPath = url.pathname.match(/^\/client\/v4\/zones\/zone-1\/dns_records\/([^/]+)$/);
    if (recordPath !== null) {
      const id = decodeURIComponent(recordPath[1] ?? "");
      if (method === "GET") {
        const record = records.get(id);
        return record === undefined
          ? json(
              {
                errors: [{ code: 81044, message: "not found" }],
                messages: [],
                result: null,
                success: false,
              },
              { status: 404 },
            )
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

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}
