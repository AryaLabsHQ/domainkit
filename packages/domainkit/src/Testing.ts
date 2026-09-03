/**
 * domainkit/testing — fakes and conformance runners so hosts test against the seam instead of
 * stubbing global fetch.
 */
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";

import * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import { storage as storageCases } from "./internal/conformance/storage.ts";
import * as Principal from "./Principal.ts";
import * as Provider from "./Provider.ts";
import * as Storage from "./Storage.ts";

/** In-memory Storage. Same as `Storage.layerMemory`; re-exported for discoverability. */
export const storage: Layer.Layer<Storage.Storage> = Storage.layerMemory;

export const principal: Principal.Shape = Principal.make({
  ownerId: "org_test",
  actorId: "user_test",
});

export interface FakeProviderOptions {
  readonly id?: string;
  /** Zones the fake credential can reach. Default: `example.com`. */
  readonly zones?: ReadonlyArray<string>;
  /** Pre-existing records, to produce `Noop` and `Conflict` operations. */
  readonly records?: ReadonlyArray<{ readonly zone: string; readonly record: DnsRecord.Observed }>;
  /** Offer OAuth in addition to tokens; the fake redirects to `callbackUrl` immediately. */
  readonly oauth?: boolean;
  /** Fail the write at this zero-based index, to exercise partial receipts. */
  readonly failWrite?: (index: number) => boolean;
}

export interface FakeProvider extends Provider.Definition<{ readonly account: string }> {
  readonly records: (zone: string) => ReadonlyArray<DnsRecord.Observed>;
  /** Every credential the fake issued, oldest first. */
  readonly issued: () => ReadonlyArray<string>;
  /** How many credentials were revoked at the fake. */
  readonly revoked: () => number;
}

interface Zone {
  readonly name: string;
  readonly rows: Array<{ readonly id: string; readonly record: DnsRecord.Observed }>;
}

/** Every fake zone created in this process, so `resolver()` can answer from them. */
const registry = new Set<Zone>();

const Context = Schema.Struct({ account: Schema.String });
const TargetContext = Schema.Struct({ zone: Schema.String });

/** A provider definition with a token method (and optional OAuth) over in-memory zones. */
export const provider = (options: FakeProviderOptions = {}): FakeProvider => {
  const id = options.id ?? "fake";
  const zones = new Map<string, Zone>();
  let nextId = 1;
  let writes = 0;
  let revokedCount = 0;
  const issued: Array<string> = [];
  for (const name of options.zones ?? ["example.com"]) {
    const zone: Zone = { name: DomainName.fromStringUnsafe(name), rows: [] };
    zones.set(zone.name, zone);
    registry.add(zone);
  }
  for (const { zone: name, record } of options.records ?? []) {
    const zone = zones.get(DomainName.fromStringUnsafe(name));
    if (zone === undefined) throw new Error(`Fake provider ${id} has no zone ${name}`);
    zone.rows.push({ id: `${id}-${nextId++}`, record });
  }

  const issue = (prefix: string): Provider.IssuedCredential => {
    const secret = `${prefix}-${issued.length + 1}`;
    issued.push(secret);
    return { secret: Redacted.make(secret), context: { account: id }, expiresAt: null };
  };

  const zoneOf = (target: Provider.Target) =>
    Effect.suspend(() => {
      const decoded = Schema.decodeUnknownOption(TargetContext)(target.context);
      const zone = decoded._tag === "Some" ? zones.get(decoded.value.zone) : undefined;
      return zone === undefined
        ? DomainKitError.fail(new DomainKitError.NotFound({ entity: "zone", id: target.zone }))
        : Effect.succeed(zone);
    });

  const targets = () =>
    [...zones.values()].map((zone): Provider.Target => ({
      zone: zone.name,
      context: { zone: zone.name },
      label: zone.name,
    }));

  const oauth: Provider.OAuthAuth = {
    label: "Sign in (fake)",
    scopes: ["dns"],
    start: (input) =>
      Effect.succeed({
        authorizationUrl: `${input.callbackUrl}?${new URLSearchParams({
          state: input.state,
          code: "fake-code",
        })}`,
      }),
    complete: (input) =>
      input.code === "fake-code"
        ? Effect.map(DateTime.now, (now) => ({
            ...issue("oauth"),
            expiresAt: DateTime.add(now, { hours: 1 }),
          }))
        : DomainKitError.fail(
            new DomainKitError.Unauthenticated({ message: "fake provider rejected the code" }),
          ),
    refresh: (credential) =>
      Redacted.value(credential.secret).startsWith("revoked")
        ? DomainKitError.fail(
            new DomainKitError.Unauthenticated({ message: "fake refresh token was revoked" }),
          )
        : Effect.map(DateTime.now, (now) => ({
            ...issue("oauth"),
            expiresAt: DateTime.add(now, { hours: 1 }),
          })),
    revoke: () => Effect.sync(() => void (revokedCount += 1)),
  };

  const definition = Provider.make<{ readonly account: string }>({
    id,
    name: `Fake ${id}`,
    context: Context,
    auth: {
      token: {
        label: "Token (fake)",
        requiredCapabilities: ["dns:read", "dns:write"],
        authenticate: (token) =>
          Redacted.value(token).length === 0
            ? DomainKitError.fail(
                new DomainKitError.Unauthenticated({
                  message: "fake provider rejected an empty token",
                }),
              )
            : Effect.succeed({ secret: token, context: { account: id }, expiresAt: null }),
      },
      ...(options.oauth === true ? { oauth } : {}),
    },
    session: () => ({
      capabilities: () => Effect.succeed(["dns:read", "dns:write"]),
      listTargets: () => Effect.succeed(targets()),
      resolveTarget: (domain) =>
        Effect.map(DomainName.decode(domain), (name) => Provider.resolveAmong(name, targets())),
      dns: (target) => ({
        list: () =>
          Effect.map(zoneOf(target), (zone) =>
            zone.rows.map(({ id: providerRecordId, record }) => ({ record, providerRecordId })),
          ),
        create: (_zone, record) =>
          Effect.gen(function* () {
            const zone = yield* zoneOf(target);
            const index = writes;
            writes += 1;
            if (options.failWrite?.(index) === true) {
              return yield* DomainKitError.fail(
                new DomainKitError.ProviderUnavailable({
                  provider: id,
                  message: `fake provider failed write ${index}`,
                }),
              );
            }
            if (!DomainName.isWithin(record.name, zone.name)) {
              return yield* DomainKitError.fail(
                new DomainKitError.ProviderRejected({
                  provider: id,
                  message: `${record.name} is outside ${zone.name}`,
                }),
              );
            }
            const providerRecordId = `${id}-${nextId++}`;
            zone.rows.push({ id: providerRecordId, record });
            return { providerRecordId };
          }),
        get: (_zone, providerRecordId) =>
          Effect.map(
            zoneOf(target),
            (zone) => zone.rows.find((row) => row.id === providerRecordId)?.record ?? null,
          ),
        delete: (_zone, providerRecordId) =>
          Effect.map(zoneOf(target), (zone) => {
            const index = zone.rows.findIndex((row) => row.id === providerRecordId);
            if (index >= 0) zone.rows.splice(index, 1);
          }),
      }),
    }),
  });

  return {
    ...definition,
    records: (zone) =>
      zones.get(DomainName.fromStringUnsafe(zone))?.rows.map(({ record }) => record) ?? [],
    issued: () => issued,
    revoked: () => revokedCount,
  };
};

/** Records every fake provider currently holds for `name`, across all fake zones. */
export const fakeRecords = (name: string): ReadonlyArray<DnsRecord.Observed> =>
  [...registry]
    .flatMap((zone) => zone.rows.map(({ record }) => record))
    .filter((record) => record.name === name);

export const conformance = {
  /** Runs every Storage invariant (tenant isolation, leases, exactly-once continuations, revocation recovery). */
  storage: storageCases,
};
