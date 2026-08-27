import {
  DnsRecord,
  DomainName,
  Provisioning,
  type DnsProvider,
  type DnsResolver,
  Verification,
} from "domainkit";

export async function provisionWithManualApproval(
  provider: DnsProvider.Interface,
  resolver: DnsResolver.Interface,
): Promise<void> {
  const zone = DomainName.parse("example.com");
  const requirement = DnsRecord.parse({
    _tag: "TXT",
    metadata: { ownership: "customer", provenance: "example", purpose: "domain verification" },
    name: "_verify.example.com",
    policy: "append",
    ttl: 300,
    value: "verification-value",
  });
  const plan = await Provisioning.create({ provider, requirements: [requirement], zone });

  // Present these instructions or the structured operations to the user before approval.
  console.log(Provisioning.renderManualInstructions(plan));

  const authorization = await Provisioning.authorize(plan);
  await Provisioning.apply({ authorization, plan, provider });
  await Verification.record({ provider, record: requirement, resolver, zone });
}
