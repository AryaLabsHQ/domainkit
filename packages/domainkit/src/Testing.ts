/**
 * domainkit/testing — fakes and conformance runners so hosts test against the seam instead of
 * stubbing global fetch.
 */
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";

import * as DnsRecord from "./DnsRecord.ts";
import * as DomainKit from "./DomainKit.ts";
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import { provider as providerCases } from "./internal/conformance/provider.ts";
import { storage as storageCases } from "./internal/conformance/storage.ts";
import * as Principal from "./Principal.ts";
import * as Provider from "./Provider.ts";
import * as Resolver from "./Resolver.ts";
import * as Server from "./Server.ts";
import * as Storage from "./Storage.ts";
import * as Transport from "./Transport.ts";

/** In-memory Storage. Same as `Storage.layerMemory`; re-exported for discoverability. */
export const storage: Layer.Layer<Storage.Service> = Storage.layerMemory;

export const principal: Principal.Interface = Principal.make({
  ownerId: "org_test",
  actorId: "user_test",
});

export interface FakeProviderOptions {
  readonly id?: string;
  /** The name a customer reads. Default `Fake <id>`; a fixture that ships screenshots sets it. */
  readonly name?: string;
  /** Zones the fake credential can reach. Default: `example.com`. */
  readonly zones?: ReadonlyArray<string>;
  /** Pre-existing records, to produce `Noop` and `Conflict` operations. */
  readonly records?: ReadonlyArray<{ readonly zone: string; readonly record: DnsRecord.Observed }>;
  /** Offer OAuth in addition to tokens; the fake redirects to `callbackUrl` immediately. */
  readonly oauth?: boolean;
  /** Fail the write at this zero-based index, to exercise partial receipts. */
  readonly failWrite?: (index: number) => boolean;
  /** Nameservers per zone; default `ns1.<zone>`, `ns2.<zone>`. `resolver()` answers NS queries from them. */
  readonly nameservers?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Suffixes the fake declares as `Definition.nameservers`, so `Connect.discover` can name it as a host. */
  readonly nameserverSuffixes?: ReadonlyArray<string>;
}

export interface FakeProvider extends Provider.Definition<FakeContext> {
  readonly records: (zone: string) => ReadonlyArray<DnsRecord.Observed>;
  /** Every credential the fake issued, oldest first. */
  readonly issued: () => ReadonlyArray<string>;
  /** How many credentials were revoked at the fake. */
  readonly revoked: () => number;
}

interface Zone {
  readonly name: string;
  readonly nameservers: ReadonlyArray<string>;
  readonly rows: Array<{ readonly id: string; readonly record: DnsRecord.Observed }>;
}

/** Every fake zone created in this process, so `resolver()` can answer from them. */
const registry = new Set<Zone>();

/** Account context carries `account`; target context carries `zone`. One schema covers both. */
const Context = Schema.Struct({
  account: Schema.optionalKey(Schema.String),
  zone: Schema.optionalKey(Schema.String),
});
type FakeContext = typeof Context.Type;
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
    const normalized = DomainName.fromStringUnsafe(name);
    const zone: Zone = {
      name: normalized,
      nameservers: options.nameservers?.[name] ??
        options.nameservers?.[normalized] ?? [`ns1.${normalized}`, `ns2.${normalized}`],
      rows: [],
    };
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
        ? Errors.fail(new Reason.NotFound({ entity: "zone", id: target.zone }))
        : Effect.succeed(zone);
    });

  const targets = () =>
    [...zones.values()].map((zone): Provider.Target => ({
      zone: zone.name,
      context: { zone: zone.name },
      label: zone.name,
      nameservers: zone.nameservers,
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
        : Errors.fail(new Reason.Unauthenticated({ message: "fake provider rejected the code" })),
    refresh: (credential) =>
      Redacted.value(credential.secret).startsWith("revoked")
        ? Errors.fail(new Reason.Unauthenticated({ message: "fake refresh token was revoked" }))
        : Effect.map(DateTime.now, (now) => ({
            ...issue("oauth"),
            expiresAt: DateTime.add(now, { hours: 1 }),
          })),
    revoke: () => Effect.sync(() => void (revokedCount += 1)),
  };

  const definition = Provider.make<FakeContext>({
    id,
    name: options.name ?? `Fake ${id}`,
    ...(options.nameserverSuffixes === undefined
      ? {}
      : { nameservers: options.nameserverSuffixes }),
    context: Context,
    contextVersion: "fake.v1",
    auth: {
      token: Provider.tokenAuth({
        label: "Token (fake)",
        requiredCapabilities: ["dns:read", "dns:write"],
        fields: Schema.Struct({ token: Schema.RedactedFromValue(Schema.String) }),
        authenticate: ({ token }) =>
          Redacted.value(token).length === 0
            ? Errors.fail(
                new Reason.Unauthenticated({
                  message: "fake provider rejected an empty token",
                }),
              )
            : Effect.succeed({ secret: token, context: { account: id }, expiresAt: null }),
      }),
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
              return yield* Errors.fail(
                new Reason.ProviderUnavailable({
                  provider: id,
                  message: `fake provider failed write ${index}`,
                }),
              );
            }
            if (!DomainName.isWithin(record.name, zone.name)) {
              return yield* Errors.fail(
                new Reason.ProviderRejected({
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

/** NS records for every fake zone named `name`, so `resolver()` can answer authority queries. */
const fakeNameservers = (name: string): ReadonlyArray<DnsRecord.Observed> =>
  [...registry]
    .filter((zone) => zone.name === name)
    .flatMap((zone) =>
      zone.nameservers.map((nameserver) => DnsRecord.ns({ name: zone.name, nameserver })),
    );

/** Records every fake provider currently holds for `name`, across all fake zones. */
export const fakeRecords = (name: string): ReadonlyArray<DnsRecord.Observed> =>
  [...registry]
    .flatMap((zone) => zone.rows.map(({ record }) => record))
    .filter((record) => record.name === name);

export interface FakeResolverOptions {
  /** The name every answer carries. A UI reads it as the observer. Default `fake`. */
  readonly id?: string;
}

/**
 * A resolver answering from the fake providers' zones, or from an explicit table. Every answer is
 * attributed to `options.id`, which a fixture that ships screenshots names after a real resolver.
 */
export const resolver = (
  answers?: ReadonlyArray<{
    readonly name: string;
    readonly records: ReadonlyArray<DnsRecord.Observed>;
  }>,
  options: FakeResolverOptions = {},
): Layer.Layer<Resolver.Service> =>
  Layer.succeed(Resolver.Service)({
    resolve: (name, type) =>
      Effect.sync(() => {
        const normalized = DomainName.fromString(name);
        const lookup = normalized._tag === "Some" ? normalized.value : name;
        const table =
          answers === undefined
            ? [...fakeRecords(lookup), ...fakeNameservers(lookup)]
            : answers.filter((entry) => entry.name === lookup).flatMap((entry) => entry.records);
        const records = table.filter(
          (record) => (record._tag === "Opaque" ? record.type : record._tag) === type,
        );
        return [
          Resolver.Outcome.Answered({
            answer: {
              resolver: options.id ?? "fake",
              records,
              negative: records.length === 0,
              ttl: 60,
            },
          }),
        ];
      }),
  });

export interface TransportOptions {
  /** Which groups the fake server exposes, so a UI can be tested against a partial host. */
  readonly capabilities?: ReadonlyArray<Transport.Capability>;
  readonly provider?: FakeProviderOptions;
  readonly resolver?: FakeResolverOptions;
}

export interface RecordedCall {
  /** `connection.inspect`, `provisioning.approve`, ... */
  readonly method: string;
  /** The call's only argument, or the argument list when the method takes more than one. */
  readonly input: unknown;
}

type TransportMethod = (
  ...args: ReadonlyArray<never>
) => Effect.Effect<unknown, Errors.DomainKitError>;

export interface RecordingTransport extends Transport.Interface {
  readonly calls: ReadonlyArray<RecordedCall>;
}

/**
 * A transport over an in-memory `domainkit/server` and memory Storage, recording every call. What
 * `@domainkit/react` tests render against, instead of stubbing global `fetch`.
 */
export const transport = (options: TransportOptions = {}): RecordingTransport => {
  const fake = provider(options.provider);
  // The handler's layer holds memory Storage and a throwaway custody key, so there is nothing to
  // release; a test that wants the server disposed builds `Server.toWebHandler` itself.
  const { handler } = Server.toWebHandler(
    DomainKit.layerMemory({
      providers: [fake],
      resolver: resolver(undefined, options.resolver),
    }).pipe(
      Layer.merge(Layer.succeed(Server.Identity)({ principal: () => Effect.succeed(principal) })),
    ),
  );
  const live = Transport.fromFetch("http://domainkit.test", {
    fetch: (input, init) => handler(new Request(input, init)),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
  });
  const calls: Array<RecordedCall> = [];
  const recorded = Object.fromEntries(
    Transport.capabilities(live).map((capability) => [
      capability,
      Object.fromEntries(
        Object.entries(live[capability] as unknown as Record<string, TransportMethod>).map(
          ([name, method]) => [
            name,
            (...args: ReadonlyArray<never>) =>
              Effect.suspend(() => {
                calls.push({
                  method: `${capability}.${name}`,
                  input: args.length > 1 ? args : args[0],
                });
                return method(...args);
              }),
          ],
        ),
      ),
    ]),
  ) as Transport.Interface;
  return { ...recorded, calls };
};

export type { Case as ProviderCase } from "./internal/conformance/provider.ts";
export type { Case as StorageCase } from "./internal/conformance/storage.ts";

export const conformance = {
  /** Runs every Storage invariant (tenant isolation, leases, exactly-once continuations, revocation recovery). */
  storage: storageCases,
  /** Runs create/readback/cleanup, exact-noop, conflict, stale-plan, partial-apply, and rejected-token against a real provider definition. */
  provider: providerCases,
};
