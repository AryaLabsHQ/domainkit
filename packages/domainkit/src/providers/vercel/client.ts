import { Effect, Schema as S } from "effect";

import type * as ProviderAuth from "../../auth/manifest.ts";
import type * as Secret from "../../auth/secret.ts";
import * as Connection from "../../auth/connection.ts";
import * as DomainName from "../../domain/domain-name.ts";
import type * as DnsRecord from "../../domain/dns-record.ts";
import type * as ZoneDiscovery from "../../discovery/zone-discovery.ts";
import * as Zones from "../../discovery/zones.ts";
import * as DnsProvider from "../../provider/provider.ts";
import * as ProviderSession from "../../provider/session.ts";
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
  readonly providerId: "vercel";
  readonly forTarget: (
    target: Connection.ProviderTarget,
  ) => Effect.Effect<DnsProvider.Interface, DnsProvider.Error>;
  readonly listAccounts: () => Effect.Effect<ReadonlyArray<Account>, DnsProvider.Error>;
  readonly listZones: (
    input?: ListZonesInput,
  ) => Effect.Effect<ReadonlyArray<Zone>, DnsProvider.Error>;
  readonly listTargets: (
    input?: ProviderSession.ListTargetsInput,
  ) => Effect.Effect<ReadonlyArray<Connection.ProviderTarget>, DnsProvider.Error>;
  readonly resolveTarget: (
    domain: DomainName.DomainName,
  ) => Effect.Effect<ProviderSession.Resolution, DnsProvider.Error>;
  readonly validateToken: () => Effect.Effect<ProviderAuth.TokenValidation, DnsProvider.Error>;
}

/** Exposes Vercel zone lookup as the optional provider discovery capability. */
export function discovery(client: Interface): ZoneDiscovery.Source {
  return {
    listZones: (name) => client.listZones({ name }),
    provider: client,
  };
}

interface TargetOptions {
  readonly target: Connection.ProviderTarget;
}

type InternalOptions = Options & Partial<TargetOptions>;

/** Creates an Effect-native Vercel client without owning the credential lifecycle. */
export function make(options: Options): Interface {
  return makeClient(options);
}

function makeClient(options: InternalOptions): Interface {
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

  const discoverZone = Effect.fn("VercelClient.discoverZone")((name: DomainName.DomainName) =>
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
      if (!hasDnsStorage(envelope.domain, config.serviceType)) {
        return null;
      }
      return envelope.domain;
    }).pipe(
      Effect.catchTag("ProviderError", (cause) =>
        cause.reason === "not_found" ? Effect.succeed(null) : Effect.fail(cause),
      ),
    ),
  );

  const resolveZone = Effect.fn("VercelClient.resolveZone")((name: DomainName.DomainName) =>
    Effect.gen(function* () {
      if (options.target !== undefined) {
        if (name !== options.target.zoneName && !name.endsWith(`.${options.target.zoneName}`)) {
          return yield* Effect.fail(
            failure(
              "resolveZone",
              `Vercel target ${options.target.zoneName} does not cover ${name}`,
              { reason: "not_found" },
            ),
          );
        }
        return options.target.zoneName;
      }
      const domain = yield* discoverZone(name);
      if (domain === null) {
        return yield* Effect.fail(
          failure(
            "resolveZone",
            `Vercel zone ${name} is not configured for authoritative DNS in the selected account`,
            { reason: "not_found" },
          ),
        );
      }
      return yield* DomainName.decode(domain.name).pipe(
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

  const getRecord = Effect.fn("VercelClient.getRecord")(
    (zoneName: DomainName.DomainName, providerRecordId: string) =>
      Effect.gen(function* () {
        const storageZone = yield* resolveZone(zoneName);
        let until: number | null = null;
        while (true) {
          const values: Record<string, string> = { limit: "100" };
          if (until !== null) values.until = String(until);
          const { body, response } = yield* request(
            withContext(`/v5/domains/${encodeURIComponent(storageZone)}/records`, values),
            "getRecord",
          );
          const envelope = yield* decode(Protocol.RecordListEnvelope, body, "getRecord", response);
          const record = envelope.records.find(({ id }) => id === providerRecordId);
          if (record !== undefined) return yield* Records.decode(storageZone, record);
          const next = envelope.pagination?.next ?? null;
          if (next === null) return null;
          until = next;
        }
      }),
  );

  const deleteRecord = Effect.fn("VercelClient.deleteRecord")(
    (zoneName: DomainName.DomainName, providerRecordId: string) =>
      Effect.gen(function* () {
        const storageZone = yield* resolveZone(zoneName);
        yield* request(
          withContext(
            `/v2/domains/${encodeURIComponent(storageZone)}/records/${encodeURIComponent(providerRecordId)}`,
          ),
          "deleteRecord",
          { method: "DELETE" },
        );
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
          hasDnsStorage(domain) && (input.name === undefined || domain.name === input.name),
      );
      if (domains.length > 0 || input.name === undefined) {
        return yield* Effect.forEach(domains, projectZone);
      }
      const discovered = yield* discoverZone(input.name);
      return discovered === null ? [] : [yield* projectZone(discovered)];
    }),
  );

  const listTargets = Effect.fn("VercelClient.listTargets")(
    (input: ProviderSession.ListTargetsInput = {}) =>
      Effect.gen(function* () {
        const names =
          input.domain === undefined
            ? undefined
            : new Set(Zones.candidates(input.domain).map((name) => String(name)));
        const domains = (yield* allDomains()).filter(
          (domain) =>
            hasDnsStorage(domain) &&
            (names === undefined || names.has(domain.name)) &&
            (input.accountId === undefined || (domain.teamId ?? domain.userId) === input.accountId),
        );
        if (domains.length > 0 || input.domain === undefined) {
          return yield* Effect.forEach(domains, targetFromDomain);
        }
        for (const name of Zones.candidates(input.domain)) {
          const discovered = yield* discoverZone(name);
          if (discovered !== null) return [yield* targetFromDomain(discovered)];
        }
        return [];
      }),
  );

  const resolveTarget = Effect.fn("VercelClient.resolveTarget")((domain: DomainName.DomainName) =>
    Effect.gen(function* () {
      const candidates = yield* listTargets({ domain });
      for (const zoneName of Zones.candidates(domain)) {
        const matches = candidates.filter((target) => target.zoneName === zoneName);
        if (matches.length === 1) {
          const target = matches[0];
          if (target !== undefined) return ProviderSession.Resolution.Resolved({ target });
        }
        if (matches.length > 1) {
          return ProviderSession.Resolution.SelectionRequired({ candidates: matches });
        }
      }
      return ProviderSession.Resolution.NotFound({ domain });
    }),
  );

  const forTarget = Effect.fn("VercelClient.forTarget")((target: Connection.ProviderTarget) =>
    Effect.gen(function* () {
      if (target.accountKind === "team") {
        if (options.context._tag !== "team" || options.context.teamId !== target.accountId) {
          return yield* Effect.fail(
            failure("forTarget", "Vercel team target is outside the selected installation", {
              reason: "authorization",
            }),
          );
        }
      } else if (target.accountKind === "personal" && options.context._tag !== "personal") {
        return yield* Effect.fail(
          failure("forTarget", "Vercel personal target is outside the selected installation", {
            reason: "authorization",
          }),
        );
      } else if (target.accountKind === null) {
        return yield* Effect.fail(
          failure("forTarget", "Vercel targets must identify a personal or team account", {
            reason: "request",
          }),
        );
      }
      const client = makeClient({ ...options, target });
      return {
        id: client.id,
        createRecord: client.createRecord,
        deleteRecord: client.deleteRecord,
        getRecord: client.getRecord,
        listRecords: client.listRecords,
      } satisfies DnsProvider.Interface;
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
    providerId: "vercel",
    createRecord,
    deleteRecord,
    getRecord,
    listAccounts,
    listRecords,
    listZones,
    listTargets,
    resolveTarget,
    forTarget,
    validateToken,
  };
}

function hasDnsStorage(
  domain: Protocol.Domain,
  configuredServiceType: Protocol.DomainConfig["serviceType"] = domain.serviceType,
): boolean {
  return (
    configuredServiceType === "zeit.world" ||
    domain.zone === true ||
    domain.intendedNameservers.length > 0
  );
}

const projectZone = Effect.fn("VercelClient.projectZone")((domain: Protocol.Domain) =>
  Effect.gen(function* () {
    const name = yield* DomainName.decode(domain.name).pipe(
      Effect.mapError((cause) => failure("listZones", cause.message, { reason: "response" })),
    );
    const nameservers = yield* Effect.forEach(domain.intendedNameservers, (nameserver) =>
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

const targetFromDomain = Effect.fn("VercelClient.targetFromDomain")((domain: Protocol.Domain) =>
  Effect.gen(function* () {
    const zoneName = yield* DomainName.decode(domain.name).pipe(
      Effect.mapError((cause) => failure("listTargets", cause.message, { reason: "response" })),
    );
    const nameservers = yield* Effect.forEach(
      domain.nameservers.length > 0 ? domain.nameservers : domain.intendedNameservers,
      (nameserver) =>
        DomainName.decode(nameserver).pipe(
          Effect.mapError((cause) => failure("listTargets", cause.message, { reason: "response" })),
        ),
    );
    return {
      accountId: domain.teamId ?? domain.userId,
      accountKind: domain.teamId === null ? ("personal" as const) : ("team" as const),
      evidence: {
        nameservers,
        status: domain.verified ? "active" : "pending",
        zoneType: domain.serviceType,
      },
      zoneId: domain.id,
      zoneName,
    } satisfies Connection.ProviderTarget;
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
