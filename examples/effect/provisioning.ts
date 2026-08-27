import { Effect, Layer } from "effect";
import { Digest, DnsProvider, DnsRecord, DomainName, Provisioning } from "domainkit/effect";

export function createPlan(provider: DnsProvider.Interface) {
  const requirement = DnsRecord.parse({
    _tag: "CNAME",
    metadata: { ownership: "customer", provenance: "example", purpose: "tracking" },
    name: "track.example.com",
    policy: "exclusive",
    target: "tracking.example.net",
    ttl: 300,
  });
  return Provisioning.create({
    requirements: [requirement],
    zone: DomainName.parse("example.com"),
  }).pipe(
    Effect.provide(
      Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer),
    ),
  );
}
