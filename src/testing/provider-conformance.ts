import { Effect, Layer, Schema } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import * as Deletion from "../plan/deletion.ts";
import * as Digest from "../plan/canonical-json.ts";
import * as Provisioning from "../plan/plan.ts";
import * as DnsProvider from "../provider/provider.ts";

export class Error extends Schema.TaggedError<Error>()("ProviderConformanceError", {
  case: Schema.String,
  message: Schema.String,
  providerId: Schema.String,
}) {}

export interface Input {
  readonly makeProvider: () => Effect.Effect<DnsProvider.Interface, DnsProvider.Error>;
  readonly prefix?: string;
  readonly zone: DomainName.DomainName;
}

export interface Report {
  readonly cases: ReadonlyArray<string>;
  readonly providerId: string;
  readonly zone: DomainName.DomainName;
}

/** Adapt a fresh Promise-shaped provider factory for the Effect-native conformance runner. */
export function fromAsync(makeProvider: () => DnsProvider.AsyncInterface): Input["makeProvider"] {
  return () => Effect.sync(() => DnsProvider.fromAsync(makeProvider()));
}

const cases = [
  "create-readback-cleanup",
  "exact-noop",
  "conflict",
  "stale-plan",
  "partial-apply-cleanup",
] as const;

/** Run the deterministic offline contract every DomainKit DNS adapter must satisfy. */
export const run = Effect.fn("ProviderConformance.run")(function* (input: Input) {
  const makeProvider = () =>
    Effect.suspend(input.makeProvider).pipe(
      Effect.catchDefect((cause) =>
        Effect.fail(
          new Error({
            case: "factory",
            message: cause instanceof globalThis.Error ? cause.message : "Provider factory failed",
            providerId: "unknown",
          }),
        ),
      ),
    );
  const first = yield* makeProvider();
  const providerId = first.id;
  const prefix = input.prefix ?? "domainkit-conformance";
  yield* createReadbackCleanup(first, input.zone, prefix);
  yield* exactNoop(yield* makeProvider(), input.zone, prefix);
  yield* conflict(yield* makeProvider(), input.zone, prefix);
  yield* stalePlan(yield* makeProvider(), input.zone, prefix);
  yield* partialApplyCleanup(yield* makeProvider(), input.zone, prefix);
  return { cases, providerId, zone: input.zone } satisfies Report;
});

function createReadbackCleanup(
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  prefix: string,
) {
  const requirements = createRequirements(zone, prefix);
  return Effect.gen(function* () {
    const { plan } = yield* Provisioning.create({
      requirements,
      target: Provisioning.Target.ExactZone({ zone }),
    });
    yield* requireTags(provider, "create-readback-cleanup", plan.operations, ["create", "create"]);
    const receipt = yield* Provisioning.apply({
      authorization: yield* Provisioning.authorize(plan),
      plan,
    });
    yield* requireCondition(
      provider,
      "create-readback-cleanup",
      receipt.status === "complete" &&
        receipt.operations.every(({ providerRecordId }) => providerRecordId !== null),
      "apply must return a complete receipt with provider record IDs",
    );
    const observed = yield* provider.listRecords(zone);
    yield* requireCondition(
      provider,
      "create-readback-cleanup",
      requirements.every((requirement) =>
        observed.some(
          (record) => record._tag !== "Opaque" && DnsRecord.equals(record, requirement),
        ),
      ),
      "listRecords must return every created record, including across provider pages",
    );
    const deletion = yield* Deletion.create({ plan, receipt });
    const deletionReceipt = yield* Deletion.apply({
      authorization: yield* Deletion.authorize(deletion),
      plan: deletion,
    });
    yield* requireCondition(
      provider,
      "create-readback-cleanup",
      deletionReceipt.status === "complete" &&
        requirementsAbsent(yield* provider.listRecords(zone), requirements),
      "receipt-bound cleanup must remove every created record",
    );
  }).pipe(Effect.provide(providerLayer(provider)));
}

function exactNoop(provider: DnsProvider.Interface, zone: DomainName.DomainName, prefix: string) {
  const requirement = cname(zone, `${prefix}-exact`);
  return Effect.gen(function* () {
    const created = yield* provider.createRecord(zone, requirement);
    const { plan } = yield* Provisioning.create({
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone }),
    });
    yield* requireTags(provider, "exact-noop", plan.operations, ["noop"]);
    const receipt = yield* Provisioning.apply({
      authorization: yield* Provisioning.authorize(plan),
      plan,
    });
    yield* requireCondition(
      provider,
      "exact-noop",
      receipt.operations.length === 0,
      "an exact plan must not create another record",
    );
    yield* deleteCreated(provider, zone, created.providerRecordId, "exact-noop");
  }).pipe(Effect.provide(providerLayer(provider)));
}

function conflict(provider: DnsProvider.Interface, zone: DomainName.DomainName, prefix: string) {
  const requirement = cname(zone, `${prefix}-conflict`);
  const occupied = txt(zone, `${prefix}-conflict`, "occupied");
  return Effect.gen(function* () {
    const created = yield* provider.createRecord(zone, occupied);
    const { plan } = yield* Provisioning.create({
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone }),
    });
    yield* requireTags(provider, "conflict", plan.operations, ["conflict"]);
    const failure = yield* Provisioning.apply({
      authorization: yield* Provisioning.authorize(plan),
      plan,
    }).pipe(Effect.flip);
    yield* requireCondition(
      provider,
      "conflict",
      failure instanceof Provisioning.ConflictError,
      "apply must fail closed on incompatible state",
    );
    yield* deleteCreated(provider, zone, created.providerRecordId, "conflict");
  }).pipe(Effect.provide(providerLayer(provider)));
}

function stalePlan(provider: DnsProvider.Interface, zone: DomainName.DomainName, prefix: string) {
  const requirement = cname(zone, `${prefix}-stale`);
  return Effect.gen(function* () {
    const { plan } = yield* Provisioning.create({
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone }),
    });
    const authorization = yield* Provisioning.authorize(plan);
    const created = yield* provider.createRecord(zone, requirement);
    const failure = yield* Provisioning.apply({ authorization, plan }).pipe(Effect.flip);
    yield* requireCondition(
      provider,
      "stale-plan",
      failure instanceof Provisioning.StaleError,
      "apply must reject provider state that changed after authorization",
    );
    yield* deleteCreated(provider, zone, created.providerRecordId, "stale-plan");
  }).pipe(Effect.provide(providerLayer(provider)));
}

function partialApplyCleanup(
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  prefix: string,
) {
  let creates = 0;
  const flaky = DnsProvider.Service.of({
    ...provider,
    createRecord: Effect.fn("ProviderConformance.createRecord")((target, record) => {
      creates += 1;
      return creates === 1
        ? provider.createRecord(target, record)
        : Effect.fail(
            new DnsProvider.Error({
              message: "injected conformance failure",
              operation: "createRecord",
              providerId: provider.id,
            }),
          );
    }),
  });
  const requirements = [
    cname(zone, `${prefix}-partial-one`),
    txt(zone, `${prefix}-partial-two`, "domainkit"),
  ];
  return Effect.gen(function* () {
    const { plan } = yield* Provisioning.create({
      requirements,
      target: Provisioning.Target.ExactZone({ zone }),
    });
    const failure = yield* Provisioning.apply({
      authorization: yield* Provisioning.authorize(plan),
      plan,
    }).pipe(Effect.flip);
    yield* requireCondition(
      provider,
      "partial-apply-cleanup",
      failure instanceof Provisioning.PartialApplyError && failure.receipt.operations.length === 1,
      "a later write failure must preserve the first confirmed write in a partial receipt",
    );
    if (!(failure instanceof Provisioning.PartialApplyError)) return;
    const deletion = yield* Deletion.create({ plan, receipt: failure.receipt }).pipe(
      Effect.provide(providerLayer(provider)),
    );
    yield* Deletion.apply({
      authorization: yield* Deletion.authorize(deletion),
      plan: deletion,
    }).pipe(Effect.provide(providerLayer(provider)));
    yield* requireCondition(
      provider,
      "partial-apply-cleanup",
      requirementsAbsent(yield* provider.listRecords(zone), requirements),
      "partial receipt cleanup must remove the confirmed write",
    );
  }).pipe(Effect.provide(providerLayer(flaky)));
}

function requirementsAbsent(
  observed: ReadonlyArray<DnsRecord.Observed>,
  requirements: ReadonlyArray<DnsRecord.DnsRecord>,
): boolean {
  return requirements.every((requirement) =>
    observed.every((record) => record._tag === "Opaque" || !DnsRecord.equals(record, requirement)),
  );
}

function providerLayer(provider: DnsProvider.Interface) {
  return Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
}

function createRequirements(zone: DomainName.DomainName, prefix: string) {
  return [cname(zone, `${prefix}-create`), txt(zone, `${prefix}-page`, "domainkit")];
}

function cname(zone: DomainName.DomainName, label: string) {
  return DnsRecord.parse({
    _tag: "CNAME",
    metadata: { ownership: "tester", provenance: "domainkit", purpose: "conformance" },
    name: `${label}.${zone}`,
    policy: "exclusive",
    target: "target.example.net",
    ttl: 300,
  });
}

function txt(zone: DomainName.DomainName, label: string, value: string) {
  return DnsRecord.parse({
    _tag: "TXT",
    metadata: { ownership: "tester", provenance: "domainkit", purpose: "conformance" },
    name: `${label}.${zone}`,
    policy: "append",
    ttl: 300,
    value,
  });
}

function requireTags(
  provider: DnsProvider.Interface,
  testCase: string,
  operations: ReadonlyArray<{ readonly _tag: string }>,
  expected: ReadonlyArray<string>,
) {
  return requireCondition(
    provider,
    testCase,
    JSON.stringify(operations.map(({ _tag }) => _tag)) === JSON.stringify(expected),
    `expected operations ${expected.join(", ")}`,
  );
}

function requireCondition(
  provider: DnsProvider.Interface,
  testCase: string,
  condition: boolean,
  message: string,
) {
  return condition
    ? Effect.void
    : Effect.fail(new Error({ case: testCase, message, providerId: provider.id }));
}

function deleteCreated(
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  providerRecordId: string | null,
  testCase: string,
) {
  return providerRecordId === null
    ? Effect.fail(
        new Error({
          case: testCase,
          message: "provider must return record IDs for safe cleanup",
          providerId: provider.id,
        }),
      )
    : provider.deleteRecord(zone, providerRecordId);
}
