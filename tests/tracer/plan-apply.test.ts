import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyPlan,
  authorizePlan,
  createPlan,
  parseDnsRecord,
  renderManualInstructions,
} from "../../src/index.ts";
import { createPlan as createPlanEffect } from "../../src/effect.ts";
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
    const first = await createPlan({ provider, requirements: [requirement], zone: "example.com" });

    expect(first.operations.map(({ _tag }) => _tag)).toEqual(["create"]);
    expect(renderManualInstructions(first)[0]).toContain("CREATE CNAME click.example.com");
    const equivalent = await Effect.runPromise(
      createPlanEffect({ provider, requirements: [requirement], zone: "EXAMPLE.COM." }),
    );
    expect(equivalent).toEqual(first);

    const authorization = await authorizePlan(first);
    const receipt = await applyPlan({
      authorization,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      plan: first,
      provider,
    });
    expect(receipt.operations).toHaveLength(1);

    const second = await createPlan({ provider, requirements: [requirement], zone: "example.com" });
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
    const plan = await createPlan({ provider, requirements: [requirement], zone: "example.com" });
    expect(plan.operations[0]?._tag).toBe("conflict");
    await expect(
      applyPlan({ authorization: await authorizePlan(plan), plan, provider }),
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
      provider,
      requirements: [requirement, secondRequirement],
      zone: "example.com",
    });
    const authorization = await authorizePlan(plan);

    await expect(
      applyPlan({ authorization: { ...authorization, planDigest: "wrong" }, plan, provider }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(
      applyPlan({
        authorization,
        plan: { ...plan, providerId: "tampered" },
        provider,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    await expect(authorizePlan(plan, [authorization.operationIds[0]!])).rejects.toMatchObject({
      _tag: "AuthorizationError",
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
      provider,
      requirements: [additional],
      zone: "example.com",
    });
    expect(create.operations[0]?._tag).toBe("create");

    const drift = await createPlan({
      provider,
      requirements: [{ ...existing, ttl: 300 }],
      zone: "example.com",
    });
    expect(drift.operations[0]).toMatchObject({ _tag: "noop", ttlDrift: true });
  });
});
