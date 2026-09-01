import { Effect, Layer } from "effect";
import { Digest, DnsProvider, DnsRecord, DomainName, Provisioning } from "domainkit";

export function createPlan(provider: DnsProvider.Interface) {
  const requirement = DnsRecord.Cname.make({
    metadata: { ownership: "customer", provenance: "example", purpose: "tracking" },
    name: DomainName.parse("track.example.com"),
    policy: "exclusive",
    target: DomainName.parse("tracking.example.net"),
    ttl: 300,
  });
  return Provisioning.create({
    requirements: [requirement],
    target: Provisioning.Target.ExactZone({ zone: DomainName.parse("example.com") }),
  }).pipe(
    Effect.provide(
      Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer),
    ),
    Effect.map(({ plan }) => plan),
  );
}
