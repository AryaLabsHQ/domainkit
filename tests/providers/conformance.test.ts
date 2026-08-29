import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DnsRecord, DomainName } from "../../src/effect.ts";
import * as DnsProvider from "../../src/provider/provider.ts";
import { InMemoryDnsProvider, ProviderConformance } from "../../src/testing.ts";

describe("provider-author conformance contract", () => {
  it.effect("runs against an external-style adapter without first-party internals", () =>
    Effect.gen(function* () {
      const report = yield* ProviderConformance.run({
        makeProvider: ProviderConformance.fromAsync(() =>
          InMemoryDnsProvider.toAsync({
            id: "third-party",
            records: {
              "example.com": [
                DnsRecord.parse({
                  _tag: "TXT",
                  metadata: { ownership: "customer", provenance: "fixture", purpose: "unrelated" },
                  name: "existing.example.com",
                  policy: "append",
                  ttl: 300,
                  value: "preserve-me",
                }),
              ],
            },
          }),
        ),
        prefix: "external-adapter",
        zone: DomainName.parse("example.com"),
      });
      assert.deepStrictEqual(report, {
        cases: [
          "create-readback-cleanup",
          "exact-noop",
          "conflict",
          "stale-plan",
          "partial-apply-cleanup",
        ],
        providerId: "third-party",
        zone: DomainName.parse("example.com"),
      });
    }),
  );

  it.effect("reports synchronous provider factory failures as typed conformance errors", () =>
    Effect.gen(function* () {
      const result = yield* ProviderConformance.run({
        makeProvider: ProviderConformance.fromAsync(() => {
          throw new Error("invalid adapter fixture");
        }),
        zone: DomainName.parse("example.com"),
      }).pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag !== "Failure") return;
      const failure = result.failure;
      assert.ok(failure instanceof ProviderConformance.Error);
      if (!(failure instanceof ProviderConformance.Error)) return;
      assert.strictEqual(failure.case, "factory");
      assert.match(failure.message, /invalid adapter fixture/);
    }),
  );

  it.effect("cleans up fixture records when a conformance assertion fails", () =>
    Effect.gen(function* () {
      const zone = DomainName.parse("example.com");
      const provider = InMemoryDnsProvider.make({ id: "failing-readback" });
      const failingReadback = DnsProvider.Service.of({
        ...provider,
        listRecords: Effect.fn("FailingReadback.listRecords")((target) =>
          provider
            .listRecords(target)
            .pipe(Effect.map((records) => (records.length === 0 ? records : []))),
        ),
      });

      const result = yield* ProviderConformance.run({
        makeProvider: () => Effect.succeed(failingReadback),
        prefix: "failed-case",
        zone,
      }).pipe(Effect.result);

      assert.strictEqual(result._tag, "Failure");
      assert.deepStrictEqual(yield* provider.listRecords(zone), []);
    }),
  );

  it.effect("cleans up confirmed fixture records after a partial apply", () =>
    Effect.gen(function* () {
      const zone = DomainName.parse("example.com");
      const provider = InMemoryDnsProvider.make({ id: "partial-apply" });
      let creates = 0;
      const partiallyFailing = DnsProvider.Service.of({
        ...provider,
        createRecord: Effect.fn("PartialApply.createRecord")((target, record) => {
          creates += 1;
          return creates === 1
            ? provider.createRecord(target, record)
            : Effect.fail(
                new DnsProvider.Error({
                  message: "injected second write failure",
                  operation: "createRecord",
                  providerId: provider.id,
                }),
              );
        }),
      });

      const result = yield* ProviderConformance.run({
        makeProvider: () => Effect.succeed(partiallyFailing),
        prefix: "partial-case",
        zone,
      }).pipe(Effect.result);

      assert.strictEqual(result._tag, "Failure");
      assert.deepStrictEqual(yield* provider.listRecords(zone), []);
    }),
  );

  it.effect("detects failed cleanup even when listRecords makes the record opaque", () =>
    Effect.gen(function* () {
      const zone = DomainName.parse("example.com");
      const provider = InMemoryDnsProvider.make({ id: "opaque-cleanup" });
      let deletionAttempted = false;
      const opaqueAfterDeletion = DnsProvider.Service.of({
        ...provider,
        deleteRecord: Effect.fn("OpaqueCleanup.deleteRecord")(() => {
          deletionAttempted = true;
          return Effect.void;
        }),
        listRecords: Effect.fn("OpaqueCleanup.listRecords")((target) =>
          provider.listRecords(target).pipe(
            Effect.map((records) =>
              deletionAttempted
                ? records.map((record, index) => ({
                    _tag: "Opaque" as const,
                    name: record.name,
                    providerRecordId: `opaque-${index}`,
                    providerType: record._tag,
                  }))
                : records,
            ),
          ),
        ),
      });

      const result = yield* ProviderConformance.run({
        makeProvider: () => Effect.succeed(opaqueAfterDeletion),
        prefix: "opaque-case",
        zone,
      }).pipe(Effect.result);

      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual(deletionAttempted, true);
      assert.strictEqual((yield* provider.listRecords(zone)).length, 2);
    }),
  );
});
