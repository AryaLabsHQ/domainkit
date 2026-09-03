import { Effect, Schema as S } from "effect";

import * as DomainKitError from "../../DomainKitError.ts";
import * as DomainName from "../../DomainName.ts";
import type * as Provider from "../../Provider.ts";
import { bearer, classify, type Fetch, rejected, requestJson } from "../http.ts";
import * as Protocol from "./protocol.ts";
import * as Records from "./records.ts";

export const provider = "vercel";

export interface Options {
  readonly token: string;
  readonly fetch: Fetch;
  readonly baseUrl: string;
}

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError>;

const url = (
  options: Options,
  path: string,
  teamId: string | null,
  values: Record<string, string> = {},
) => {
  const target = new URL(`${options.baseUrl}${path}`);
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
  if (teamId !== null) target.searchParams.set("teamId", teamId);
  return target;
};

const call = <R extends S.ConstraintDecoder<unknown>>(
  options: Options,
  target: URL,
  result: R,
  init?: RequestInit,
): Fx<R["Type"]> =>
  Effect.gen(function* () {
    const reply = yield* requestJson({
      fetch: options.fetch,
      provider,
      url: target,
      init: bearer(options.token, init),
    });
    if (!reply.ok) {
      const detail = S.decodeUnknownOption(Protocol.ErrorEnvelope)(reply.body);
      const message =
        detail._tag === "Some"
          ? detail.value.error.message
          : `Vercel request failed with HTTP ${reply.status}`;
      const code = detail._tag === "Some" ? detail.value.error.code : undefined;
      const headers = new Headers(reply.headers);
      const resetMs = detail._tag === "Some" ? detail.value.error.limit?.resetMs : undefined;
      if (resetMs !== undefined && !headers.has("retry-after")) {
        headers.set("retry-after", String(Math.max(0, Math.ceil((resetMs - Date.now()) / 1_000))));
      }
      return yield* DomainKitError.fail(
        classify(provider, code === "rate_limited" ? 429 : reply.status, headers, message, code),
      );
    }
    return yield* DomainKitError.decode(result, reply.body).pipe(
      Effect.mapError(() =>
        rejected(provider, "Vercel response did not match its API contract", "response"),
      ),
    );
  });

export const user = (options: Options) =>
  call(options, url(options, "/v2/user", null), Protocol.UserEnvelope).pipe(
    Effect.map(({ user }) => user),
  );

export const teams = (options: Options): Fx<ReadonlyArray<typeof Protocol.Team.Type>> =>
  Effect.gen(function* () {
    const rows: Array<typeof Protocol.Team.Type> = [];
    let until: number | null = null;
    while (true) {
      const values: Record<string, string> = { limit: "100" };
      if (until !== null) values.until = String(until);
      const envelope = yield* call(
        options,
        url(options, "/v2/teams", null, values),
        Protocol.TeamListEnvelope,
      );
      rows.push(...envelope.teams);
      if (envelope.pagination.next === null) return rows;
      until = envelope.pagination.next;
    }
  });

/** Domains with Vercel-hosted DNS for one account (`teamId` null means the personal account). */
export const zones = (
  options: Options,
  teamId: string | null,
): Fx<ReadonlyArray<Protocol.Domain>> =>
  Effect.gen(function* () {
    const rows: Array<Protocol.Domain> = [];
    let until: number | null = null;
    while (true) {
      const values: Record<string, string> = { limit: "100" };
      if (until !== null) values.until = String(until);
      const envelope = yield* call(
        options,
        url(options, "/v5/domains", teamId, values),
        Protocol.DomainListEnvelope,
      );
      rows.push(...envelope.domains);
      if (envelope.pagination.next === null) return rows.filter(hasDnsStorage);
      until = envelope.pagination.next;
    }
  });

export const exchangeCode = (input: {
  readonly options: Options;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly callbackUrl: string;
}): Fx<typeof Protocol.IntegrationToken.Type> =>
  Effect.gen(function* () {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.callbackUrl,
    });
    const reply = yield* requestJson({
      fetch: input.options.fetch,
      provider,
      url: `${input.options.baseUrl}/v2/oauth/access_token`,
      init: {
        method: "POST",
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    });
    if (!reply.ok) {
      const detail = S.decodeUnknownOption(Protocol.ErrorEnvelope)(reply.body);
      return yield* DomainKitError.fail(
        classify(
          provider,
          reply.status,
          reply.headers,
          detail._tag === "Some"
            ? detail.value.error.message
            : `Vercel token exchange failed with HTTP ${reply.status}`,
          detail._tag === "Some" ? detail.value.error.code : undefined,
        ),
      );
    }
    return yield* DomainKitError.decode(Protocol.IntegrationToken, reply.body).pipe(
      Effect.mapError(() =>
        rejected(provider, "Vercel token response did not match its API contract", "response"),
      ),
    );
  });

const listRecords = (
  options: Options,
  teamId: string | null,
  zone: string,
): Fx<ReadonlyArray<Provider.ObservedRecord>> =>
  Effect.gen(function* () {
    const rows: Array<Provider.ObservedRecord> = [];
    let until: number | null = null;
    while (true) {
      const values: Record<string, string> = { limit: "100" };
      if (until !== null) values.until = String(until);
      const envelope = yield* call(
        options,
        url(options, `/v5/domains/${encodeURIComponent(zone)}/records`, teamId, values),
        Protocol.RecordListEnvelope,
      );
      rows.push(
        ...(yield* Effect.forEach(envelope.records, (record) => Records.decode(zone, record))),
      );
      const next = envelope.pagination?.next ?? null;
      if (next === null) return rows;
      until = next;
    }
  });

export const dns = (options: Options, teamId: string | null): Provider.Dns => ({
  list: (zone) => listRecords(options, teamId, zone),
  create: (zone, record) =>
    Effect.gen(function* () {
      if (!DomainName.isWithin(record.name, zone))
        return yield* Records.outsideZone(zone, record.name);
      const body = yield* Records.encode(zone, record);
      const created = yield* call(
        options,
        url(options, `/v2/domains/${encodeURIComponent(zone)}/records`, teamId),
        Protocol.CreateRecordEnvelope,
        { method: "POST", body: JSON.stringify(body) },
      );
      return { providerRecordId: created.uid };
    }),
  get: (zone, providerRecordId) =>
    listRecords(options, teamId, zone).pipe(
      Effect.map(
        (records) =>
          records.find((row) => row.providerRecordId === providerRecordId)?.record ?? null,
      ),
    ),
  delete: (zone, providerRecordId) =>
    call(
      options,
      url(
        options,
        `/v2/domains/${encodeURIComponent(zone)}/records/${encodeURIComponent(providerRecordId)}`,
        teamId,
      ),
      S.Unknown,
      { method: "DELETE" },
    ).pipe(Effect.asVoid),
});

function hasDnsStorage(domain: Protocol.Domain): boolean {
  return (
    domain.serviceType === "zeit.world" ||
    domain.zone === true ||
    domain.intendedNameservers.length > 0
  );
}
