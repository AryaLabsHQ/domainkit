import { Effect, Schema as S } from "effect";

import type * as ProviderAuth from "../../auth/manifest.ts";
import type * as Secret from "../../auth/secret.ts";
import * as DomainName from "../../domain/domain-name.ts";
import type * as DnsRecord from "../../domain/dns-record.ts";
import * as DnsProvider from "../../provider/provider.ts";
import * as Protocol from "./protocol.ts";
import * as Records from "./records.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Configuration for an Effect-native Cloudflare authoritative-DNS client. */
export interface Options {
  readonly accountId: string;
  readonly baseUrl?: string;
  /** Capabilities the host required when issuing or authorizing this credential. */
  readonly capabilities: ProviderAuth.TokenValidation["capabilities"];
  readonly fetch?: Fetch;
  readonly token: Secret.Value;
  readonly tokenKind?: "account" | "user";
}

export interface ListZonesInput {
  readonly accountId?: string;
  readonly name?: DomainName.DomainName;
}

export type Account = Protocol.Account;

/** A portable Cloudflare authoritative zone with normalized nameserver evidence. */
export interface Zone {
  readonly accountId: string;
  readonly id: string;
  readonly name: DomainName.DomainName;
  readonly nameservers: ReadonlyArray<DomainName.DomainName>;
  readonly status: string | null;
}

export interface Interface extends DnsProvider.Interface {
  readonly listAccounts: () => Effect.Effect<ReadonlyArray<Account>, DnsProvider.Error>;
  readonly listZones: (
    input?: ListZonesInput,
  ) => Effect.Effect<ReadonlyArray<Zone>, DnsProvider.Error>;
  readonly validateToken: () => Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error>;
}

/** Creates an Effect-native Cloudflare client without owning the credential lifecycle. */
export function make(options: Options): Interface {
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");

  const request = Effect.fn("CloudflareClient.request")(
    (path: string, operation: string, init?: RequestInit) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${baseUrl}${path}`, {
              ...init,
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${options.token.expose()}`,
                ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
                ...init?.headers,
              },
            }),
          catch: () =>
            failure(operation, "Cloudflare request failed", {
              reason: "transport",
            }),
        });
        const body = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: () => {
            const retryAfterMs = retryAfter(response.headers.get("retry-after"));
            return failure(
              operation,
              response.ok
                ? "Cloudflare returned a non-JSON response"
                : `Cloudflare request failed with HTTP ${response.status}`,
              {
                reason: response.ok ? "response" : reason(response.status),
                ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
                status: response.status,
              },
            );
          },
        });
        return { body, response } as const;
      }),
  );

  const listZonesPage = Effect.fn("CloudflareClient.listZonesPage")(
    (accountId: string | undefined, name: DomainName.DomainName | undefined, page: number) =>
      Effect.gen(function* () {
        const query = new URLSearchParams({ page: String(page), per_page: "50" });
        query.set("type", "full,partial,secondary,internal");
        if (accountId !== undefined) query.set("account.id", accountId);
        if (name !== undefined) query.set("name", name);
        const { body, response } = yield* request(`/zones?${query}`, "listZones");
        yield* ensureSuccess(body, "listZones", response);
        const envelope = yield* decode(Protocol.ZoneListEnvelope, body, "listZones", response);
        return envelope;
      }),
  );

  const allZones = Effect.fn("CloudflareClient.allZones")(
    (accountId?: string, name?: DomainName.DomainName) =>
      Effect.gen(function* () {
        const zones: Array<Protocol.Zone> = [];
        let page = 1;
        while (true) {
          const envelope = yield* listZonesPage(accountId, name, page);
          zones.push(...envelope.result);
          const totalPages = envelope.result_info?.total_pages;
          if (
            (totalPages !== undefined && page >= totalPages) ||
            (totalPages === undefined && envelope.result.length < 50)
          ) {
            return zones;
          }
          page += 1;
        }
      }),
  );

  const resolveZone = Effect.fn("CloudflareClient.resolveZone")((name: DomainName.DomainName) =>
    Effect.gen(function* () {
      const matches = yield* allZones(options.accountId, name);
      const match = matches[0];
      if (matches.length === 1 && match !== undefined) return match;
      return yield* Effect.fail(
        failure(
          "resolveZone",
          matches.length === 0
            ? `Cloudflare zone ${name} was not found in account ${options.accountId}`
            : `Cloudflare returned multiple zones named ${name} in account ${options.accountId}`,
          { reason: matches.length === 0 ? "not_found" : "response" },
        ),
      );
    }),
  );

  const listRecords = Effect.fn("CloudflareClient.listRecords")((zoneName: DomainName.DomainName) =>
    Effect.gen(function* () {
      const zone = yield* resolveZone(zoneName);
      const records: Array<DnsRecord.Observed> = [];
      let page = 1;
      while (true) {
        const query = new URLSearchParams({ page: String(page), per_page: "100" });
        const { body, response } = yield* request(
          `/zones/${encodeURIComponent(zone.id)}/dns_records?${query}`,
          "listRecords",
        );
        yield* ensureSuccess(body, "listRecords", response);
        const envelope = yield* decode(Protocol.RecordListEnvelope, body, "listRecords", response);
        records.push(...(yield* Effect.forEach(envelope.result, Records.decode)));
        const totalPages = envelope.result_info?.total_pages;
        if (
          (totalPages !== undefined && page >= totalPages) ||
          (totalPages === undefined && envelope.result.length < 100)
        ) {
          return records;
        }
        page += 1;
      }
    }),
  );

  const createRecord = Effect.fn("CloudflareClient.createRecord")(
    (zoneName: DomainName.DomainName, record: DnsRecord.DnsRecord) =>
      Effect.gen(function* () {
        const zone = yield* resolveZone(zoneName);
        const { body, response } = yield* request(
          `/zones/${encodeURIComponent(zone.id)}/dns_records`,
          "createRecord",
          { body: JSON.stringify(Records.encode(record)), method: "POST" },
        );
        yield* ensureSuccess(body, "createRecord", response);
        const envelope = yield* decode(Protocol.RecordEnvelope, body, "createRecord", response);
        return { providerRecordId: envelope.result.id };
      }),
  );

  const getRecord = Effect.fn("CloudflareClient.getRecord")(
    (zoneName: DomainName.DomainName, providerRecordId: string) =>
      Effect.gen(function* () {
        const zone = yield* resolveZone(zoneName);
        const { body, response } = yield* request(
          `/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(providerRecordId)}`,
          "getRecord",
        );
        if (response.status === 404) return null;
        yield* ensureSuccess(body, "getRecord", response);
        const envelope = yield* decode(Protocol.RecordEnvelope, body, "getRecord", response);
        return yield* Records.decode(envelope.result);
      }),
  );

  const deleteRecord = Effect.fn("CloudflareClient.deleteRecord")(
    (zoneName: DomainName.DomainName, providerRecordId: string) =>
      Effect.gen(function* () {
        const zone = yield* resolveZone(zoneName);
        const { body, response } = yield* request(
          `/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(providerRecordId)}`,
          "deleteRecord",
          { method: "DELETE" },
        );
        yield* ensureSuccess(body, "deleteRecord", response);
      }),
  );

  const listAccounts = Effect.fn("CloudflareClient.listAccounts")(() =>
    allZones().pipe(
      Effect.map((zones) => {
        const accounts = new Map<string, Protocol.Account>();
        for (const zone of zones) accounts.set(zone.account.id, zone.account);
        return [...accounts.values()].sort((left, right) => left.name.localeCompare(right.name));
      }),
    ),
  );

  const listZones = Effect.fn("CloudflareClient.listZones")((input: ListZonesInput = {}) =>
    allZones(input.accountId ?? options.accountId, input.name).pipe(
      Effect.flatMap((zones) => Effect.forEach(zones, projectZone)),
    ),
  );

  const validateToken = Effect.fn("CloudflareClient.validateToken")(() =>
    Effect.gen(function* () {
      const path =
        options.tokenKind === "account"
          ? `/accounts/${encodeURIComponent(options.accountId)}/tokens/verify`
          : "/user/tokens/verify";
      const { body, response } = yield* request(path, "validateToken");
      yield* ensureSuccess(body, "validateToken", response);
      const envelope = yield* decode(Protocol.TokenEnvelope, body, "validateToken", response);
      if (envelope.result.status !== "active") {
        return yield* Effect.fail(
          failure("validateToken", `Cloudflare token is ${envelope.result.status}`, {
            reason: "authentication",
            status: response.status,
          }),
        );
      }
      yield* allZones(options.accountId);
      const expiresAt =
        envelope.result.expires_on === undefined ? null : new Date(envelope.result.expires_on);
      if (expiresAt !== null && Number.isNaN(expiresAt.valueOf())) {
        return yield* Effect.fail(
          failure("validateToken", "Cloudflare token expiry is not a valid timestamp", {
            reason: "response",
            status: response.status,
          }),
        );
      }
      return {
        accountId: options.accountId,
        capabilities: options.capabilities,
        expiresAt,
        scopes: [],
      };
    }),
  );

  return {
    id: "cloudflare",
    createRecord,
    deleteRecord,
    getRecord,
    listAccounts,
    listRecords,
    listZones,
    validateToken,
  };
}

const projectZone = Effect.fn("CloudflareClient.projectZone")((zone: Protocol.Zone) =>
  Effect.gen(function* () {
    const name = yield* DomainName.decode(zone.name).pipe(
      Effect.mapError((cause) => failure("listZones", cause.message, { reason: "response" })),
    );
    const nameservers = yield* Effect.forEach(zone.name_servers, (nameserver) =>
      DomainName.decode(nameserver).pipe(
        Effect.mapError((cause) => failure("listZones", cause.message, { reason: "response" })),
      ),
    );
    return {
      accountId: zone.account.id,
      id: zone.id,
      name,
      nameservers,
      status: zone.status ?? null,
    };
  }),
);

function decode<A>(
  schema: S.ConstraintCodec<A, unknown, never, unknown>,
  input: unknown,
  operation: string,
  response: Response,
): Effect.Effect<A, DnsProvider.Error> {
  return S.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((cause) =>
      failure(operation, `Cloudflare response did not match its API contract: ${cause.message}`, {
        reason: "response",
        status: response.status,
      }),
    ),
  );
}

function ensureSuccess(
  input: unknown,
  operation: string,
  response: Response,
): Effect.Effect<void, DnsProvider.Error> {
  return S.decodeUnknownEffect(Protocol.BaseEnvelope)(input).pipe(
    Effect.mapError(() =>
      failure(operation, "Cloudflare response did not contain a valid API envelope", {
        reason: "response",
        status: response.status,
      }),
    ),
    Effect.flatMap((envelope) => {
      if (response.ok && envelope.success) return Effect.void;
      const detail = envelope.errors[0];
      const retryAfterMs = retryAfter(response.headers.get("retry-after"));
      return Effect.fail(
        failure(
          operation,
          detail?.message ?? `Cloudflare request failed with HTTP ${response.status}`,
          {
            ...(detail === undefined ? {} : { code: detail.code }),
            reason: reason(response.status, detail?.code),
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            status: response.status,
          },
        ),
      );
    }),
  );
}

function reason(status: number, code?: number): DnsProvider.ErrorReason {
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "not_found";
  if (status === 409 || code === 81056 || code === 81057 || code === 81058) return "conflict";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "response";
  return "request";
}

function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function failure(
  operation: string,
  message: string,
  fields: Partial<Pick<DnsProvider.Error, "code" | "reason" | "retryAfterMs" | "status">> = {},
): DnsProvider.Error {
  return new DnsProvider.Error({
    ...fields,
    message,
    operation,
    providerId: "cloudflare",
  });
}
