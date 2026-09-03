import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connect, DnsRecord, DomainKit, Principal, Provision, Verify } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

/** What a host test looks like: connect -> plan -> apply -> observe with no global fetch stubbing. */
describe("host-shaped test against the seam", () => {
  it.effect("observes hand-applied records over the fake transport", () => {
    const transport = Testing.transport({ provider: { zones: ["customer.dev"] } });
    const requirements = [
      DnsRecord.txt({ name: "_acme.mail.customer.dev", value: "acme-verify=1" }),
    ];
    return Effect.gen(function* () {
      const verification = transport.verification;
      if (verification === undefined) return assert.fail("verification capability missing");
      const readiness = yield* verification.observe("mail.customer.dev", { requirements });
      assert.strictEqual(readiness.attachmentId, null);
      assert.deepStrictEqual(
        readiness.requirements.map(({ status, evidence }) => [
          status,
          evidence.map(({ _tag }) => _tag),
        ]),
        [["missing", ["PublicDns"]]],
      );
      assert.deepStrictEqual(transport.calls.at(-1), {
        method: "verification.observe",
        input: ["mail.customer.dev", { requirements }],
      });
    });
  });

  it.effect(
    "runs the whole lifecycle on memory storage with the fake provider and resolver",
    () => {
      const fake = Testing.provider({ zones: ["customer.dev"] });
      return Effect.gen(function* () {
        const started = yield* Connect.start({
          provider: fake.id,
          method: Connect.Method.token("customer-token"),
          domain: "mail.customer.dev",
        });
        assert.strictEqual(started._tag, "Connected");
        const plan = yield* Provision.plan({
          domain: "mail.customer.dev",
          requirements: [
            DnsRecord.mx({ name: "mail.customer.dev", exchange: "inbound.acme.dev", priority: 10 }),
            DnsRecord.txt({ name: "mail.customer.dev", value: "v=spf1 include:acme.dev -all" }),
          ],
        });
        const receipt = yield* Provision.apply(yield* Provision.approve(plan));
        assert.strictEqual(receipt.status, "complete");
        const readiness = yield* Verify.observe({ domain: "mail.customer.dev" });
        assert.strictEqual(readiness.overall, "ready");
        assert.strictEqual(fake.records("customer.dev").length, 2);
      }).pipe(
        Effect.provideService(Principal.Service, Testing.principal),
        Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() })),
      );
    },
  );
});
