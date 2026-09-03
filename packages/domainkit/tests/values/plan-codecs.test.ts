import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";

import { Approval, DnsRecord, Plan, Receipt } from "../../src/index.ts";

const at = DateTime.makeUnsafe("2026-09-03T00:00:00.000Z");
const record = DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev" });
const create = new Plan.Create({ id: Plan.OperationId.make("op-1"), record });
const conflict = new Plan.Conflict({
  id: Plan.OperationId.make("op-2"),
  record: DnsRecord.txt({ name: "app.example.com", value: "v" }),
  existing: [record],
  reason: "cname-collision",
});

const plan = new Plan.Plan({
  id: Plan.PlanId.make("plan-1"),
  version: "domainkit.plan.v2",
  kind: "provisioning",
  digest: Plan.Digest.make("abc"),
  domain: "app.example.com",
  zone: "example.com",
  provider: "fake",
  attachmentId: "att-1",
  operations: [create],
  createdAt: at,
  expiresAt: DateTime.add(at, { hours: 1 }),
});

describe("Plan, Approval, and Receipt codecs", () => {
  it.effect("encode plans to JSON and decode them back", () =>
    Effect.gen(function* () {
      const encoded = Plan.encode(plan);
      assert.strictEqual(encoded.createdAt, "2026-09-03T00:00:00.000Z");
      assert.strictEqual(encoded.operations[0]?._tag, "Create");
      const decoded = yield* Plan.decode(JSON.parse(JSON.stringify(encoded)));
      assert.ok(decoded instanceof Plan.Plan);
      assert.ok(decoded.operations[0] instanceof Plan.Create);
      assert.strictEqual(
        DateTime.toEpochMillis(decoded.expiresAt),
        DateTime.toEpochMillis(plan.expiresAt),
      );
      const failure = yield* Plan.decode({ ...encoded, version: "domainkit.dns-plan.v1" }).pipe(
        Effect.flip,
      );
      assert.strictEqual(failure.reason._tag, "InvalidInput");
    }),
  );

  it("reports applicability, conflicts, writes, and manual instructions", () => {
    assert.strictEqual(Plan.isApplicable(plan), true);
    const conflicting = new Plan.Plan({ ...plan, operations: [create, conflict] });
    assert.strictEqual(Plan.isApplicable(conflicting), false);
    assert.deepStrictEqual(Plan.conflicts(conflicting), [conflict]);
    assert.deepStrictEqual(Plan.writes(conflicting), [create]);
    assert.strictEqual(
      Plan.renderInstructions(conflicting),
      "ADD CNAME app.example.com edge.acme.dev\nCONFLICT (cname-collision) TXT app.example.com v",
    );
  });

  it.effect("keeps Approval and Receipt codecs in parity with Plan", () =>
    Effect.gen(function* () {
      const approval = new Approval.Approval({
        id: Approval.ApprovalId.make("apr-1"),
        version: "domainkit.approval.v2",
        kind: "provisioning",
        planId: plan.id,
        digest: plan.digest,
        operationIds: [create.id],
        approvedBy: "user_7",
        approvedAt: at,
        expiresAt: plan.expiresAt,
      });
      const receipt = new Receipt.Receipt({
        id: Receipt.ReceiptId.make("rcpt-1"),
        version: "domainkit.receipt.v2",
        kind: "provisioning",
        planId: plan.id,
        approvalId: approval.id,
        digest: plan.digest,
        provider: "fake",
        zone: "example.com",
        status: "partial",
        outcomes: [
          new Receipt.Applied({ operationId: create.id, providerRecordId: "r1" }),
          new Receipt.Failed({ operationId: conflict.id, message: "boom" }),
        ],
        appliedAt: at,
      });
      const decodedApproval = yield* Approval.decode(
        JSON.parse(JSON.stringify(Approval.encode(approval))),
      );
      assert.ok(decodedApproval instanceof Approval.Approval);
      const decodedReceipt = yield* Receipt.decode(
        JSON.parse(JSON.stringify(Receipt.encode(receipt))),
      );
      assert.ok(decodedReceipt instanceof Receipt.Receipt);
      assert.strictEqual(Receipt.isComplete(decodedReceipt), false);
      assert.deepStrictEqual(
        Receipt.applied(decodedReceipt).map(({ providerRecordId }) => providerRecordId),
        ["r1"],
      );
    }),
  );
});
