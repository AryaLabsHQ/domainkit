import { Effect, Schema as S } from "effect";

import type * as ProviderAuth from "../../auth/manifest.ts";
import type * as Secret from "../../auth/secret.ts";
import * as DomainName from "../../domain/domain-name.ts";
import type * as DnsRecord from "../../domain/dns-record.ts";
import * as DnsProvider from "../../provider/provider.ts";
import * as Protocol from "./protocol.ts";
import * as Records from "./records.ts";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Selects whether Vercel requests operate on a personal account or a team. */
export type AccountContext =
  | { readonly _tag: "personal" }
  | { readonly _tag: "team"; readonly teamId: string };

/** Configuration for an Effect-native Vercel authoritative-DNS client. */
export interface Options {
  readonly baseUrl?: string;
  /** Capabilities the host required when issuing or authorizing this credential. */
  readonly capabilities: ProviderAuth.TokenValidation["capabilities"];
  readonly context: AccountContext;
  readonly fetch?: Fetch;
  readonly token: Secret.Value;
}

export interface ListZonesInput {
  readonly name?: DomainName.DomainName;
}

/** A Vercel account visible to the supplied credential. */
export interface Account {
  readonly id: string;
  readonly name: string;
  readonly type: "personal" | "team";
}

/** A Vercel-managed authoritative zone with normalized nameserver evidence. */
export interface Zone {
  readonly accountId: string;
  readonly id: string;
  readonly name: DomainName.DomainName;
  readonly nameservers: ReadonlyArray<DomainName.DomainName>;
  readonly status: "active" | "pending";
}

export interface Interface extends DnsProvider.Interface {
  readonly listAccounts: () => Effect.Effect<ReadonlyArray<Account>, DnsProvider.Error>;
  readonly listZones: (
    input?: ListZonesInput,
  ) => Effect.Effect<ReadonlyArray<Zone>, DnsProvider.Error>;
  readonly validateToken: () => Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error>;
}

/** Creates an Effect-native Vercel client without owning the credential lifecycle. */
export function make(options: Options): Interface {
  const fetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.vercel.com").replace(/\/$/, "");

  const withContext = (path: string, values: Readonly<Record<string, string>> = {}) => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    if (options.context._tag === "team") url.searchParams.set("teamId", options.context.teamId);
    return url;
  };

  const request = Effect.fn("VercelClient.request")(
    (url: URL, operation: string, init?: RequestInit) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              ...init,
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${options.token.expose()}`,
                ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
                ...init?.headers,
              },
            }),
          catch: () => failure(operation, "Vercel request failed", { reason: "transport" }),
        });
        const body = yield* Effect.tryPromise({
          try: () => response.json() as Promise<unknown>,
          catch: () =>
            failure(
              operation,
              response.ok
                ? "Vercel returned a non-JSON response"
                : `Vercel request failed with HTTP ${response.status}`,
              {
                reason: response.ok ? "response" : reason(response.status),
                ...rateLimit(response),
                status: response.status,
              },
            ),
        });
        if (!response.ok) return yield* Effect.fail(apiFailure(body, operation, response));
        return { body, response } as const;
      }),
  );

  const allTeams = Effect.fn("VercelClient.allTeams")(() =>
    Effect.gen(function* () {
      const teams: Array<Protocol.Team> = [];
      let until: number | null = null;
      while (true) {
        const url = new URL(`${baseUrl}/v2/teams`);
        url.searchParams.set("limit", "100");
        if (until !== null) url.searchParams.set("until", String(until));
        const { body, response } = yield* request(url, "listAccounts");
        const envelope = yield* decode(Protocol.TeamListEnvelope, body, "listAccounts", response);
        teams.push(...envelope.teams);
        if (envelope.pagination.next === null) return teams;
        until = envelope.pagination.next;
      }
    }),
  );

  const allDomains = Effect.fn("VercelClient.allDomains")(() =>
    Effect.gen(function* () {
      const domains: Array<Protocol.Domain> = [];
      let until: number | null = null;
      while (true) {
        const values: Record<string, string> = { limit: "100" };
        if (until !== null) values.until = String(until);
        const { body, response } = yield* request(withContext("/v5/domains", values), "listZones");
        const envelope = yield* decode(Protocol.DomainListEnvelope, body, "listZones", response);
        domains.push(...envelope.domains);
        if (envelope.pagination.next === null) return domains;
        until = envelope.pagination.next;
      }
    }),
  );

  const resolveZone = Effect.fn("VercelClient.resolveZone")((name: DomainName.DomainName) =>
    Effect.gen(function* () {
      const configResult = yield* request(
        withContext(`/v6/domains/${encodeURIComponent(name)}/config`),
        "resolveZone",
      );
      const config = yield* decode(
        Protocol.DomainConfig,
        configResult.body,
        "resolveZone",
        configResult.response,
      );
      if (config.serviceType !== "zeit.world") {
        return yield* Effect.fail(
          failure(
            "resolveZone",
            `Vercel zone ${name} is not configured for authoritative DNS in the selected account`,
            { reason: "not_found" },
          ),
        );
      }
      const domainResult = yield* request(
        withContext(`/v5/domains/${encodeURIComponent(name)}`),
        "resolveZone",
      );
      const envelope = yield* decode(
        Protocol.DomainEnvelope,
        domainResult.body,
        "resolveZone",
        domainResult.response,
      );
      return yield* DomainName.decode(envelope.domain.name).pipe(
        Effect.mapError((cause) =>
          failure("resolveZone", `Vercel returned an invalid storage zone: ${cause.message}`),
        ),
      );
    }),
  );

  const listRecords = Effect.fn("VercelClient.listRecords")((zoneName: DomainName.DomainName) =>
    Effect.gen(function* () {
      const storageZone = yield* resolveZone(zoneName);
      const records: Array<DnsRecord.Observed> = [];
      let until: number | null = null;
      while (true) {
        const values: Record<string, string> = { limit: "100" };
        if (until !== null) values.until = String(until);
        const { body, response } = yield* request(
          withContext(`/v5/domains/${encodeURIComponent(storageZone)}/records`, values),
          "listRecords",
        );
        const envelope = yield* decode(Protocol.RecordListEnvelope, body, "listRecords", response);
        records.push(
          ...(yield* Effect.forEach(envelope.records, (record) =>
            Records.decode(storageZone, record),
          )),
        );
        const next = envelope.pagination?.next ?? null;
        if (next === null) {
          return records.filter(
            (record) => record.name === zoneName || record.name.endsWith(`.${zoneName}`),
          );
        }
        until = next;
      }
    }),
  );

  const createRecord = Effect.fn("VercelClient.createRecord")(
    (zoneName: DomainName.DomainName, record: DnsRecord.DnsRecord) =>
      Effect.gen(function* () {
        const storageZone = yield* resolveZone(zoneName);
        const body = yield* Effect.try({
          try: () => Records.encode(storageZone, record),
          catch: (cause) =>
            cause instanceof DnsProvider.Error
              ? cause
              : failure("createRecord", "Vercel record could not be encoded", {
                  reason: "request",
                }),
        });
        const result = yield* request(
          withContext(`/v2/domains/${encodeURIComponent(storageZone)}/records`),
          "createRecord",
          { body: JSON.stringify(body), method: "POST" },
        );
        const envelope = yield* decode(
          Protocol.CreateRecordEnvelope,
          result.body,
          "createRecord",
          result.response,
        );
        return { providerRecordId: envelope.uid };
      }),
  );

  const listAccounts = Effect.fn("VercelClient.listAccounts")(() =>
    Effect.gen(function* () {
      const userResult = yield* request(new URL(`${baseUrl}/v2/user`), "listAccounts");
      const { user } = yield* decode(
        Protocol.UserEnvelope,
        userResult.body,
        "listAccounts",
        userResult.response,
      );
      const teams = yield* allTeams();
      return [
        { id: user.id, name: user.name ?? user.username, type: "personal" as const },
        ...teams.map((team) => ({
          id: team.id,
          name: team.name ?? team.slug,
          type: "team" as const,
        })),
      ];
    }),
  );

  const listZones = Effect.fn("VercelClient.listZones")((input: ListZonesInput = {}) =>
    Effect.gen(function* () {
      const domains = (yield* allDomains()).filter(
        (domain) =>
          domain.serviceType === "zeit.world" &&
          (input.name === undefined || domain.name === input.name),
      );
      return yield* Effect.forEach(domains, projectZone);
    }),
  );

  const validateToken = Effect.fn("VercelClient.validateToken")(() =>
    Effect.gen(function* () {
      let accountId: string;
      if (options.context._tag === "team") {
        yield* allDomains();
        accountId = options.context.teamId;
      } else {
        const result = yield* request(new URL(`${baseUrl}/v2/user`), "validateToken");
        const { user } = yield* decode(
          Protocol.UserEnvelope,
          result.body,
          "validateToken",
          result.response,
        );
        accountId = user.id;
      }
      return {
        accountId,
        capabilities: options.capabilities,
        expiresAt: null,
        scopes: [],
      };
    }),
  );

  return {
    id: "vercel",
    createRecord,
    listAccounts,
    listRecords,
    listZones,
    validateToken,
  };
}

const projectZone = Effect.fn("VercelClient.projectZone")((domain: Protocol.Domain) =>
  Effect.gen(function* () {
    const name = yield* DomainName.decode(domain.name).pipe(
      Effect.mapError((cause) => failure("listZones", cause.message, { reason: "response" })),
    );
    const nameservers = yield* Effect.forEach(domain.nameservers, (nameserver) =>
      DomainName.decode(nameserver).pipe(
        Effect.mapError((cause) => failure("listZones", cause.message, { reason: "response" })),
      ),
    );
    return {
      accountId: domain.teamId ?? domain.userId,
      id: domain.id,
      name,
      nameservers,
      status: domain.verified ? "active" : "pending",
    } as const;
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
      failure(operation, `Vercel response did not match its API contract: ${cause.message}`, {
        reason: "response",
        status: response.status,
      }),
    ),
  );
}

function apiFailure(input: unknown, operation: string, response: Response): DnsProvider.Error {
  const detail = S.decodeUnknownOption(Protocol.ErrorEnvelope)(input);
  return failure(
    operation,
    detail._tag === "Some"
      ? detail.value.error.message
      : `Vercel request failed with HTTP ${response.status}`,
    {
      ...(detail._tag === "Some" ? { code: detail.value.error.code } : {}),
      reason: reason(response.status, detail._tag === "Some" ? detail.value.error.code : undefined),
      ...rateLimit(response, detail._tag === "Some" ? detail.value.error : undefined),
      status: response.status,
    },
  );
}

function reason(status: number, code?: string): DnsProvider.ErrorReason {
  if (status === 401 || code === "invalid_token") return "authentication";
  if (status === 403) return "authorization";
  if (status === 404 || code === "not_found") return "not_found";
  if (status === 409 || code === "conflict") return "conflict";
  if (status === 429 || code === "rate_limited") return "rate_limit";
  if (status >= 500) return "response";
  return "request";
}

function rateLimit(
  response: Response,
  detail?: Protocol.ErrorDetail,
): Partial<Pick<DnsProvider.Error, "retryAfterMs">> {
  const resetMs = detail?.limit?.resetMs;
  const header = response.headers.get("x-ratelimit-reset");
  const reset = resetMs ?? (header === null ? undefined : Number(header) * 1_000);
  return reset === undefined || !Number.isFinite(reset)
    ? {}
    : { retryAfterMs: Math.max(0, reset - Date.now()) };
}

function failure(
  operation: string,
  message: string,
  fields: Partial<Pick<DnsProvider.Error, "code" | "reason" | "retryAfterMs" | "status">> = {},
): DnsProvider.Error {
  return new DnsProvider.Error({ ...fields, message, operation, providerId: "vercel" });
}
