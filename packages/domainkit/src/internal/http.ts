import { Effect } from "effect";

import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface Reply {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  /** Parsed JSON, or `null` for an empty body. */
  readonly body: unknown;
}

/** One provider HTTP round trip: transport failures and non-JSON replies are already classified. */
export const requestJson = (input: {
  readonly fetch: Fetch;
  readonly provider: string;
  readonly url: URL | string;
  readonly init?: RequestInit;
}): Effect.Effect<Reply, Errors.DomainKitError> =>
  Effect.tryPromise({
    try: async (signal): Promise<Reply> => {
      const response = await input.fetch(input.url, { ...input.init, signal });
      const text = await response.text();
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new Errors.DomainKitError({
            reason: response.ok
              ? new Reason.ProviderRejected({
                  provider: input.provider,
                  message: `${input.provider} returned a non-JSON response`,
                })
              : classify(
                  input.provider,
                  response.status,
                  response.headers,
                  `HTTP ${response.status}`,
                ),
          });
        }
      }
      return { status: response.status, ok: response.ok, headers: response.headers, body };
    },
    catch: (cause) =>
      Errors.isDomainKitError(cause)
        ? cause
        : new Errors.DomainKitError({
            reason: new Reason.ProviderUnavailable({
              provider: input.provider,
              message: cause instanceof Error ? cause.message : `${input.provider} request failed`,
            }),
          }),
  });

/**
 * Map an HTTP failure to a reason: 401 -> Unauthenticated, 403 -> Forbidden, 409 or a provider
 * conflict code -> ProviderConflict, 429/5xx -> ProviderUnavailable, else ProviderRejected.
 */
export const classify = (
  provider: string,
  status: number,
  headers: Headers,
  message: string,
  code?: string,
): Reason.Model => {
  if (status === 401) return new Reason.Unauthenticated({ message });
  if (status === 403) return new Reason.Forbidden({ message });
  if (status === 409 || code === "conflict") {
    return new Reason.ProviderConflict({
      provider,
      message,
      code: code ?? String(status),
    });
  }
  if (status === 429 || status >= 500) {
    const retryAfterMs = retryAfter(headers.get("retry-after"));
    return new Reason.ProviderUnavailable({
      provider,
      message,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }
  return new Reason.ProviderRejected({
    provider,
    message,
    code: code ?? String(status),
  });
};

export const rejected = (provider: string, message: string, code?: string) =>
  new Errors.DomainKitError({
    reason: new Reason.ProviderRejected({
      provider,
      message,
      ...(code === undefined ? {} : { code }),
    }),
  });

function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export const bearer = (token: string, init?: RequestInit): RequestInit => ({
  ...init,
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...init?.headers,
  },
});
