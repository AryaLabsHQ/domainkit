import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyPlan,
  authorizePlan,
  createPlan,
  type DnsProvider,
  parseDomainName,
  parseDnsRecord,
  renderManualInstructions,
} from "../../src/index.ts";
import {
  applyPlan as applyPlanEffect,
  authorizePlan as authorizePlanEffect,
  createPlan as createPlanEffect,
  webCryptoLayer,
} from "../../src/effect.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";

const requirement = parseDnsRecord({
  _tag: "CNAME",
  metadata: {
    ownership: "example-app",
    provenance: "click-tracking",
    purpose: "Route tracked links",
  },
  name: "click.example.com",
  policy: "exclusive",
  target: "tracking.example.net",
  ttl: 300,
});

describe("plan and apply tracer", () => {
  it("runs missing -> create -> apply -> exact no-op through both APIs", async () => {
    const provider = new InMemoryDnsProvider();
    const layer = Layer.merge(provider.layer, webCryptoLayer);
    const first = await Effect.runPromise(
      createPlanEffect({ requirements: [requirement], zone: "example.com" }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(first.operations.map(({ _tag }) => _tag)).toEqual(["create"]);
    expect(renderManualInstructions(first)[0]).toContain("CREATE CNAME click.example.com");
    const equivalent = await Effect.runPromise(
      createPlanEffect({ requirements: [requirement], zone: "EXAMPLE.COM." }).pipe(
        Effect.provide(layer),
      ),
    );
    expect(equivalent).toEqual(first);

    const authorization = await Effect.runPromise(
      authorizePlanEffect(first).pipe(Effect.provide(webCryptoLayer)),
    );
    const receipt = await Effect.runPromise(
      applyPlanEffect({ authorization, plan: first }).pipe(Effect.provide(layer)),
    );
    expect(receipt.operations).toHaveLength(1);
    expect(receipt.status).toBe("complete");

    const second = await createPlan({
      provider: provider.promise,
      requirements: [requirement],
      zone: "example.com",
    });
    expect(second.operations).toMatchObject([{ _tag: "noop", ttlDrift: false }]);
  });

  it("fails closed on incompatible CNAME state", async () => {
    const provider = new InMemoryDnsProvider({
      records: {
        "example.com": [
          parseDnsRecord({
            ...requirement,
            target: "other.example.com",
          }),
        ],
      },
    });
    const plan = await createPlan({
      provider: provider.promise,
      requirements: [requirement],
      zone: "example.com",
    });
    expect(plan.operations[0]?._tag).toBe("conflict");
    await expect(
      applyPlan({ authorization: await authorizePlan(plan), plan, provider: provider.promise }),
    ).rejects.toMatchObject({ _tag: "PlanConflictError" });
  });

  it("rejects altered plans, wrong digests, and unapproved partial apply", async () => {
    const provider = new InMemoryDnsProvider();
    const secondRequirement = parseDnsRecord({
      _tag: "TXT",
      metadata: requirement.metadata,
      name: "verify.example.com",
      policy: "append",
      ttl: null,
      value: "domainkit-verification",
    });
    const plan = await createPlan({
      provider: provider.promise,
      requirements: [requirement, secondRequirement],
      zone: "example.com",
    });
    const authorization = await authorizePlan(plan);

    await expect(
      applyPlan({
        authorization: { ...authorization, planDigest: "wrong" },
        plan,
        provider: provider.promise,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      applyPlan({
        authorization,
        plan: { ...plan, providerId: "tampered" },
        provider: provider.promise,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(authorizePlan(plan, [authorization.operationIds[0]!])).rejects.toMatchObject({
      _tag: "AuthorizationError",
    });
  });

  it("rejects a plan when DNS state changes after authorization", async () => {
    const provider = new InMemoryDnsProvider();
    const plan = await createPlan({
      provider: provider.promise,
      requirements: [requirement],
      zone: "example.com",
    });
    const authorization = await authorizePlan(plan);
    await Effect.runPromise(
      provider.createRecord(
        parseDomainName("example.com"),
        parseDnsRecord({ ...requirement, target: "unexpected.example.net" }),
      ),
    );

    await expect(
      applyPlan({ authorization, plan, provider: provider.promise }),
    ).rejects.toMatchObject({
      _tag: "StalePlanError",
      approvedPlanDigest: plan.digest,
    });
  });

  it("reports successful writes when DNS changes between plan operations", async () => {
    const backing = new InMemoryDnsProvider();
    let created = 0;
    let injected = false;
    let conflictingRecord: ReturnType<typeof parseDnsRecord> | undefined;
    const provider: DnsProvider = {
      id: backing.id,
      createRecord: async (zone, record) => {
        const result = await backing.promise.createRecord(zone, record);
        created += 1;
        return result;
      },
      listRecords: async (zone) => {
        if (created === 1 && !injected && conflictingRecord !== undefined) {
          injected = true;
          await backing.promise.createRecord(zone, conflictingRecord);
        }
        return backing.promise.listRecords(zone);
      },
    };
    const additional = parseDnsRecord({
      ...requirement,
      name: "second.example.com",
      target: "second-target.example.net",
    });
    const plan = await createPlan({
      provider,
      requirements: [requirement, additional],
      zone: "example.com",
    });
    const creates = plan.operations.filter((operation) => operation._tag === "create");
    expect(creates).toHaveLength(2);
    const second = creates[1]!;
    if (second.requirement._tag !== "CNAME") throw new Error("Expected a CNAME operation");
    conflictingRecord = parseDnsRecord({
      ...second.requirement,
      target: "concurrent.example.net",
    });

    await expect(
      applyPlan({
        authorization: await authorizePlan(plan),
        now: () => new Date("2026-08-27T00:00:00.000Z"),
        plan,
        provider,
      }),
    ).rejects.toMatchObject({
      _tag: "PartialApplyError",
      causeTag: "StalePlanError",
      failedOperationId: second.id,
      receipt: {
        operations: [{ operationId: creates[0]!.id }],
        planDigest: plan.digest,
        status: "partial",
      },
    });
  });

  it("allows append-only coexistence and observes TTL drift without updating", async () => {
    const existing = parseDnsRecord({
      _tag: "TXT",
      metadata: requirement.metadata,
      name: "verify.example.com",
      policy: "append",
      ttl: 600,
      value: "existing",
    });
    const provider = new InMemoryDnsProvider({ records: { "example.com": [existing] } });
    const additional = parseDnsRecord({ ...existing, ttl: 300, value: "additional" });
    const create = await createPlan({
      provider: provider.promise,
      requirements: [additional],
      zone: "example.com",
    });
    expect(create.operations[0]?._tag).toBe("create");

    const drift = await createPlan({
      provider: provider.promise,
      requirements: [{ ...existing, ttl: 300 }],
      zone: "example.com",
    });
    expect(drift.operations[0]).toMatchObject({ _tag: "noop", ttlDrift: true });
  });
});
