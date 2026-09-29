import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  Cleanup,
  Connect,
  DnsRecord,
  DomainKit,
  Plan,
  Principal,
  Provision,
  Storage,
  Verify,
} from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";
import * as Planner from "../../src/internal/planner.ts";

const name = "mail.example.com";
const spf = DnsRecord.spf({ name, value: "v=spf1 include:mail.example.net ~all" });
const matching = DnsRecord.txt({ name, value: spf.value });
const otherSpf = DnsRecord.txt({ name, value: "V=SPF1 -all" });
const unrelated = DnsRecord.txt({ name, value: "ownership=ok" });
const exclusive = DnsRecord.txt({ name, value: "ownership=ok", policy: "exclusive", ttl: 300 });
const opaque = new DnsRecord.Opaque({ name, type: "TXT", raw: { unknown: true } });
const cname = DnsRecord.cname({ name, target: "edge.example.net" });

const cases: ReadonlyArray<{
  readonly label: string;
  readonly requirement: DnsRecord.Model;
  readonly existing: ReadonlyArray<DnsRecord.Observed>;
  readonly reason: Plan.Conflict["reason"];
}> = [
  { label: "different SPF", requirement: spf, existing: [otherSpf], reason: "spf-conflict" },
  {
    label: "matching plus another SPF",
    requirement: spf,
    existing: [matching, otherSpf],
    reason: "spf-conflict",
  },
  {
    label: "identical duplicate SPF",
    requirement: spf,
    existing: [matching, matching],
    reason: "spf-conflict",
  },
  {
    label: "exclusive exact plus different",
    requirement: exclusive,
    existing: [unrelated, matching],
    reason: "exclusive-name",
  },
  {
    label: "opaque plus exact",
    requirement: matching,
    existing: [matching, opaque],
    reason: "opaque",
  },
  {
    label: "CNAME plus exact TXT",
    requirement: matching,
    existing: [matching, cname],
    reason: "cname-collision",
  },
  {
    label: "exact CNAME plus TXT",
    requirement: cname,
    existing: [cname, unrelated],
    reason: "cname-collision",
  },
  {
    label: "opaque CNAME plus exact",
    requirement: matching,
    existing: [matching, new DnsRecord.Opaque({ name, type: "CNAME", raw: {} })],
    reason: "cname-collision",
  },
];

const connected = Connect.start({
  provider: "fake",
  method: Connect.Method.token("t"),
  domain: name,
});
const provide = (fake: Testing.FakeProvider) =>
  Effect.provide(
    DomainKit.layerMemory({
      providers: [fake],
      resolver: Testing.resolver([{ name, records: [spf, unrelated] }]),
    }),
  );
const principal = Effect.provideService(Principal.Service, Testing.principal);

describe("DNS lifecycle safety", () => {
  for (const test of cases) {
    it.effect(`blocks ${test.label} before Noop and never writes it`, () => {
      let writes = 0;
      const fake = Testing.provider({
        zones: ["example.com"],
        records: test.existing.map((record) => ({ zone: "example.com", record })),
        failWrite: () => {
          writes++;
          return false;
        },
      });
      return Effect.gen(function* () {
        yield* connected;
        const plan = yield* Provision.plan({ domain: name, requirements: [test.requirement] });
        assert.strictEqual(Plan.conflicts(plan)[0]?.reason, test.reason);
        assert.strictEqual(Verify.statusAgainst(test.requirement, test.existing), "mismatch");
        assert.strictEqual(
          (yield* Provision.approve(plan).pipe(Effect.flip)).reason._tag,
          "Conflict",
        );
        const partial = yield* Provision.approve(plan, { allowPartial: true });
        assert.deepStrictEqual(partial.operationIds, []);
        yield* Provision.apply(partial);
        assert.strictEqual(writes, 0);
        assert.strictEqual(fake.records("example.com").length, test.existing.length);
      }).pipe(principal, provide(fake));
    });
  }

  it.effect("keeps SPF through persisted plans, receipts, readiness, and cleanup", () => {
    const fake = Testing.provider({
      zones: ["example.com"],
      records: [{ zone: "example.com", record: unrelated }],
    });
    return Effect.gen(function* () {
      yield* connected;
      const plan = yield* Provision.plan({ domain: name, requirements: [spf] });
      assert.strictEqual(plan.operations[0]?._tag, "Create");
      const storage = yield* Storage.Service;
      const stored = yield* storage.attempts.get(plan.id);
      const encoded = Schema.encodeSync(Storage.Attempt)(stored);
      const decoded = Schema.decodeUnknownSync(Storage.Attempt)(
        JSON.parse(JSON.stringify(encoded)),
      );
      assert.deepStrictEqual(decoded.plan.operations[0]?.record, spf);
      const receipt = yield* Provision.apply(yield* Provision.approve(plan));
      assert.strictEqual(receipt.status, "complete");
      assert.strictEqual(
        (yield* storage.attempts.byReceipt(receipt.id)).plan.operations[0]?.record._tag,
        "TXT",
      );
      const readiness = yield* Verify.observe({ domain: name });
      assert.deepStrictEqual(readiness.requirements[0]?.record, spf);
      assert.strictEqual(readiness.overall, "ready");
      assert.deepStrictEqual((yield* Verify.latest(name))?.requirements[0]?.record, spf);
      const again = yield* Provision.plan({ domain: name, requirements: [spf] });
      assert.strictEqual(again.operations[0]?._tag, "Noop");
      const cleanup = yield* Cleanup.plan({ receiptId: receipt.id });
      assert.deepStrictEqual(cleanup.operations[0]?.record, spf);
      yield* Cleanup.apply(yield* Cleanup.approve(cleanup));
      assert.deepStrictEqual(fake.records("example.com"), [unrelated]);
    }).pipe(principal, provide(fake));
  });

  for (const [label, pair] of [
    ["two explicit SPF values", [spf, DnsRecord.spf({ name, value: otherSpf.value })]],
    ["explicit and generic SPF", [spf, otherSpf]],
    ["exclusive and append", [exclusive, matching]],
    ["CNAME and TXT", [cname, matching]],
  ] satisfies ReadonlyArray<[string, ReadonlyArray<DnsRecord.Model>]>) {
    for (const reverse of [false, true]) {
      it.effect(`rejects projected ${label}, ${reverse ? "reversed" : "forward"}`, () => {
        let writes = 0;
        const fake = Testing.provider({
          zones: ["example.com"],
          failWrite: () => {
            writes++;
            return false;
          },
        });
        return Effect.gen(function* () {
          yield* connected;
          const plan = yield* Provision.plan({
            domain: name,
            requirements: reverse ? [...pair].reverse() : pair,
          });
          assert.deepStrictEqual(
            plan.operations.map(({ _tag }) => _tag),
            ["Conflict", "Conflict"],
          );
          assert.strictEqual(
            (yield* Provision.approve(plan).pipe(Effect.flip)).reason._tag,
            "Conflict",
          );
          yield* Provision.apply(yield* Provision.approve(plan, { allowPartial: true }));
          assert.strictEqual(writes, 0);
        }).pipe(principal, provide(fake));
      });
    }
  }

  it.effect(
    "allows unrelated TXT, unmarked SPF append, duplicate requirements, and TTL drift",
    () =>
      Effect.gen(function* () {
        for (const requirements of [
          [spf, unrelated],
          [unrelated, spf],
          [spf, spf],
        ]) {
          const operations = yield* Planner.reconcile(requirements, []);
          assert.ok(operations.every(({ _tag }) => _tag !== "Conflict"));
          assert.strictEqual(
            operations.filter(
              ({ _tag, record }) => _tag === "Create" && DnsRecord.equals(record, spf),
            ).length,
            1,
          );
        }
        const generic = yield* Planner.reconcile([matching], [otherSpf]);
        assert.strictEqual(generic[0]?._tag, "Create");
        const appendExact = yield* Planner.reconcile([matching], [matching, otherSpf]);
        assert.strictEqual(appendExact[0]?._tag, "Noop");
        assert.strictEqual(Verify.statusAgainst(matching, [matching, otherSpf]), "satisfied");
        const drift = yield* Planner.reconcile([exclusive], [unrelated]);
        assert.strictEqual(drift[0]?._tag, "Noop");
        if (drift[0]?._tag === "Noop") assert.strictEqual(drift[0].ttlDrift, true);
        assert.strictEqual(Verify.statusAgainst(exclusive, [unrelated]), "satisfied");
        assert.strictEqual(Verify.statusAgainst(spf, [unrelated]), "missing");
        const boundary = yield* Planner.reconcile(
          [spf],
          [DnsRecord.txt({ name, value: "v=spf10 -all" })],
        );
        assert.strictEqual(boundary[0]?._tag, "Create");
      }),
  );

  it.effect("binds constraints to operation IDs and digests while excluding labels", () =>
    Effect.gen(function* () {
      const operation = yield* Planner.operationId(spf);
      assert.notStrictEqual(operation, yield* Planner.operationId(matching));
      assert.strictEqual(
        operation,
        yield* Planner.operationId(DnsRecord.spf({ name, value: spf.value, purpose: "mail" })),
      );
      const unsigned = {
        version: "domainkit.plan.v2",
        kind: "provisioning",
        domain: name,
        zone: "example.com",
        provider: "fake",
        attachmentId: "a",
        operations: [new Plan.Create({ id: operation, record: spf })],
      } satisfies Planner.Unsigned;
      assert.notStrictEqual(
        yield* Planner.digest(unsigned),
        yield* Planner.digest({
          ...unsigned,
          operations: [new Plan.Create({ id: operation, record: matching })],
        }),
      );
    }),
  );

  it.effect("refuses apply if an SPF collision appears after approval", () => {
    let writes = 0;
    const fake = Testing.provider({
      zones: ["example.com"],
      failWrite: () => {
        writes++;
        return false;
      },
    });
    return Effect.gen(function* () {
      const start = yield* connected;
      if (start._tag !== "Connected" || start.attachment === null) return assert.fail("attachment");
      const plan = yield* Provision.plan({ domain: name, requirements: [spf] });
      const approval = yield* Provision.approve(plan);
      const { session, target } = yield* Connect.session(start.attachment.id);
      yield* session.dns(target).create("example.com", otherSpf);
      assert.strictEqual((yield* Provision.apply(approval).pipe(Effect.flip)).reason._tag, "Stale");
      assert.strictEqual(writes, 1);
      assert.deepStrictEqual(fake.records("example.com"), [otherSpf]);
    }).pipe(principal, provide(fake));
  });
});
