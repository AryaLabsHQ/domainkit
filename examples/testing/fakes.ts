import { Effect } from "effect";
import { Connect, DnsRecord, DomainKit, Principal, Provision, Verify } from "domainkit";
import { Testing } from "domainkit/testing";

// #region provider
/**
 * A provider definition over in-memory zones, with a token method and optionally OAuth. Give each
 * test its own zone: `Testing.provider` registers zones in one process-wide table that
 * `Testing.resolver` reads.
 */
export const fake = Testing.provider({
  zones: ["plans.example.com"],
  records: [
    {
      zone: "plans.example.com",
      record: DnsRecord.txt({ name: "_acme.plans.example.com", value: "acme-verify=7f3a" }),
    },
  ],
  oauth: true,
});
// #endregion provider

// #region layer
/** One layer for the whole lifecycle: memory Storage, a throwaway custody key, and the fake pool. */
export const TestLive = DomainKit.layerMemory({
  providers: [fake],
  resolver: Testing.resolver(),
});
// #endregion layer

// #region run
/** A host test drives the real services; nothing stubs global `fetch`. */
export const plansTheSecondRecord = Effect.gen(function* () {
  yield* Connect.start({
    provider: fake.id,
    method: Connect.Method.token("test-token"),
    domain: "app.plans.example.com",
  });
  const plan = yield* Provision.plan({
    domain: "app.plans.example.com",
    requirements: [
      DnsRecord.cname({ name: "app.plans.example.com", target: "edge.acme.dev" }),
      DnsRecord.txt({ name: "_acme.plans.example.com", value: "acme-verify=7f3a" }),
    ],
  });
  return plan.operations.map((operation) => operation._tag); // ["Create", "Noop"]
}).pipe(Effect.provideService(Principal.Service, Testing.principal), Effect.provide(TestLive));
// #endregion run

// #region failures
/** Exercise a partial receipt by failing one write, and a mismatch by seeding the wrong record. */
export const failsTheSecondWrite = Testing.provider({
  zones: ["partial.example.com"],
  failWrite: (index) => index === 1,
});
// #endregion failures

// #region resolver
/** Answer public DNS from a table instead of the fake provider's own zones. */
export const StaleResolver = Testing.resolver([
  {
    name: "app.example.com",
    records: [DnsRecord.cname({ name: "app.example.com", target: "old.acme.dev" })],
  },
]);

export const seesTheOldTarget = Verify.observe({ domain: "app.example.com" });
// #endregion resolver

// #region transport
/**
 * The whole lifecycle behind a `Transport.Interface`, over an in-memory server, recording every
 * call. Declare fewer capabilities to render a UI against a host that mounted only part of the
 * group.
 */
export const transport = Testing.transport({ capabilities: ["connection", "provisioning"] });

export const callsSoFar = () => transport.calls.map((call) => call.method);
// #endregion transport
