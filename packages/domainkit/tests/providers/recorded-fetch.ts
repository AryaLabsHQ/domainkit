import type { Fetch } from "../../src/internal/http.ts";

export interface RecordedRequest {
  readonly init: RequestInit | undefined;
  readonly url: string;
}

export interface Recorded {
  readonly body: unknown;
  readonly expect?: { readonly method?: string; readonly pathname: string };
  readonly init?: ResponseInit;
  readonly json?: boolean;
}

/** Replays responses in order and records every request; an unexpected path throws. */
export function recordedFetch(responses: ReadonlyArray<Recorded>): {
  readonly fetch: Fetch;
  readonly requests: Array<RecordedRequest>;
} {
  const requests: Array<RecordedRequest> = [];
  let index = 0;
  return {
    requests,
    fetch: async (input, init) => {
      requests.push({ init, url: String(input) });
      const response = responses[index++];
      if (response === undefined)
        throw new Error(`No recorded response remains for ${String(input)}`);
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

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}
