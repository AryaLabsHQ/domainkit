import { Effect, Layer } from "effect";
import { Digest, DnsRecord, DomainName, Provisioning } from "domainkit";
import { InMemoryDnsProvider } from "domainkit/testing";

const requirement = DnsRecord.parse({
  _tag: "CNAME",
  metadata: {
    ownership: "customer",
    provenance: "product-onboarding",
    purpose: "tracking",
  },
  name: "track.example.com",
  policy: "exclusive",
  target: "tracking.example.net",
  ttl: 300,
});

const runtimeLayer = Layer.merge(InMemoryDnsProvider.layer(), Digest.webCryptoLayer);

export const quickstart = Effect.gen(function* () {
  const { plan } = yield* Provisioning.create({
    requirements: [requirement],
    target: Provisioning.Target.ExactZone({
      zone: DomainName.parse("example.com"),
    }),
  });

  const authorization = yield* Provisioning.authorize(plan);
  const receipt = yield* Provisioning.apply({ authorization, plan });

  const { plan: nextPlan } = yield* Provisioning.create({
    requirements: [requirement],
    target: Provisioning.Target.ExactZone({
      zone: DomainName.parse("example.com"),
    }),
  });

  return {
    firstOperations: plan.operations.map(({ _tag }) => _tag),
    receiptStatus: receipt.status,
    secondOperations: nextPlan.operations.map(({ _tag }) => _tag),
  };
}).pipe(Effect.provide(runtimeLayer));

export const runQuickstart = () => Effect.runPromise(quickstart);
