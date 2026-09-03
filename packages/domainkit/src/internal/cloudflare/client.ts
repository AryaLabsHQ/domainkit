import { DateTime, Effect, Schema as S } from "effect";

import type * as DnsRecord from "../../DnsRecord.ts";
import * as DomainKitError from "../../DomainKitError.ts";
import type * as Provider from "../../Provider.ts";
import { bearer, classify, type Fetch, rejected, requestJson } from "../http.ts";
import * as Protocol from "./protocol.ts";
import * as Records from "./records.ts";

export const provider = "cloudflare";

const notFound = new DomainKitError.NotFound({ entity: "zone", id: "cloudflare" });

/** Cloudflare's "record already exists" family (81056 identical, 81057 same name and content, 81058 CNAME). */
const conflictCodes = new Set([81056, 81057, 81058]);

export interface Options {
  readonly token: string;
  readonly fetch: Fetch;
  readonly baseUrl: string;
}

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError>;

const call = <R extends S.ConstraintDecoder<unknown>>(
  options: Options,
  path: string,
  result: R,
  init?: RequestInit,
): Fx<{ readonly result: R["Type"]; readonly totalPages: number | undefined }> =>
  Effect.gen(function* () {
    const reply = yield* requestJson({
      fetch: options.fetch,
      provider,
      url: `${options.baseUrl}${path}`,
      init: bearer(options.token, init),
    });
    if (reply.status === 404) return yield* DomainKitError.fail(notFound);
    const base = S.decodeUnknownOption(Protocol.BaseEnvelope)(reply.body);
    if (!reply.ok || base._tag === "None" || !base.value.success) {
      const detail = base._tag === "Some" ? base.value.errors[0] : undefined;
      if (detail !== undefined && conflictCodes.has(detail.code)) {
        return yield* DomainKitError.fail(
          new DomainKitError.ProviderConflict({
            provider,
            code: String(detail.code),
            message: detail.message,
          }),
        );
      }
      return yield* DomainKitError.fail(
        classify(
          provider,
          reply.status,
          reply.headers,
          detail?.message ?? `Cloudflare request failed with HTTP ${reply.status}`,
          detail === undefined ? undefined : String(detail.code),
        ),
      );
    }
    const contract = () =>
      rejected(provider, "Cloudflare response did not match its API contract", "response");
    const envelope = yield* DomainKitError.decode(Protocol.Envelope, reply.body).pipe(
      Effect.mapError(contract),
    );
    const decoded: R["Type"] = yield* DomainKitError.decode(result, envelope.result).pipe(
      Effect.mapError(contract),
    );
    return { result: decoded, totalPages: envelope.result_info?.total_pages };
  });

const paginate = <R extends S.ConstraintDecoder<unknown>>(
  options: Options,
  path: (page: number) => string,
  result: R,
  perPage: number,
): Fx<ReadonlyArray<R["Type"]>> =>
  Effect.gen(function* () {
    const rows: Array<R["Type"]> = [];
    let page = 1;
    while (true) {
      const reply = yield* call(options, path(page), S.Array(result));
      rows.push(...reply.result);
      const last =
        reply.totalPages === undefined ? reply.result.length < perPage : page >= reply.totalPages;
      if (last) return rows;
      page += 1;
    }
  });

/** Every zone the credential can see, across accounts; internal zones cannot host records. */
export const listZones = (options: Options, accountId?: string): Fx<ReadonlyArray<Protocol.Zone>> =>
  paginate(
    options,
    (page) => {
      const query = new URLSearchParams({ page: String(page), per_page: "50" });
      if (accountId !== undefined) query.set("account.id", accountId);
      return `/zones?${query}`;
    },
    Protocol.Zone,
    50,
  ).pipe(Effect.map((zones) => zones.filter((zone) => zone.type !== "internal")));

/** Token expiry from the verify endpoint; `null` when the token never expires or verification is unavailable. */
export const tokenExpiry = (
  options: Options,
  accountId: string | null,
): Fx<DateTime.Utc | null> => {
  const verify = (path: string) =>
    call(options, path, Protocol.Token).pipe(
      Effect.flatMap(({ result }) =>
        result.status === "active"
          ? Effect.succeed(
              typeof result.expires_on === "string" ? DateTime.makeUnsafe(result.expires_on) : null,
            )
          : DomainKitError.fail(
              new DomainKitError.Unauthenticated({
                message: `Cloudflare token is ${result.status}`,
              }),
            ),
      ),
    );
  return verify("/user/tokens/verify").pipe(
    Effect.catchIf(
      (error) => error.reason._tag !== "Unauthenticated" || accountId !== null,
      () =>
        accountId === null
          ? Effect.succeed(null)
          : verify(`/accounts/${encodeURIComponent(accountId)}/tokens/verify`).pipe(
              Effect.catchIf(
                (error) => error.reason._tag !== "Unauthenticated",
                () => Effect.succeed(null),
              ),
            ),
    ),
  );
};

export const dns = (options: Options, zoneId: string): Provider.Dns => {
  const base = `/zones/${encodeURIComponent(zoneId)}/dns_records`;
  return {
    list: (zone) =>
      paginate(
        options,
        (page) => `${base}?${new URLSearchParams({ page: String(page), per_page: "100" })}`,
        Protocol.Record,
        100,
      ).pipe(
        Effect.flatMap((records) =>
          Effect.forEach(
            records.filter((record) => Records.isWithinZone(record.name, zone)),
            Records.decode,
          ),
        ),
      ),
    create: (_zone, record: DnsRecord.DnsRecord) =>
      call(options, base, Protocol.Record, {
        method: "POST",
        body: JSON.stringify(Records.encode(record)),
      }).pipe(Effect.map(({ result }) => ({ providerRecordId: result.id }))),
    get: (_zone, providerRecordId) =>
      call(options, `${base}/${encodeURIComponent(providerRecordId)}`, Protocol.Record).pipe(
        Effect.flatMap(({ result }) => Records.decode(result)),
        Effect.map(({ record }) => record),
        Effect.catchIf(
          (error) => error.reason === notFound,
          () => Effect.succeed(null),
        ),
      ),
    delete: (_zone, providerRecordId) =>
      call(options, `${base}/${encodeURIComponent(providerRecordId)}`, S.Unknown, {
        method: "DELETE",
      }).pipe(Effect.asVoid),
  };
};
