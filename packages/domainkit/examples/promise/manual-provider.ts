import {
  DnsRecord,
  DomainName,
  type DnsPlan,
  type DnsProvider,
  type DnsResolver,
  Provisioning,
  Verification,
} from "domainkit/promise";

export async function provisionWithManualApproval(
  provider: DnsProvider.Interface,
  resolver: DnsResolver.Interface,
  requestApproval: (input: {
    readonly instructions: ReadonlyArray<string>;
    readonly plan: DnsPlan.DnsPlan;
  }) => Promise<boolean>,
): Promise<void> {
  const zone = DomainName.parse("example.com");
  const requirement = DnsRecord.Txt({
    metadata: { ownership: "customer", provenance: "example", purpose: "domain verification" },
    name: DomainName.parse("_verify.example.com"),
    policy: "append",
    ttl: 300,
    value: "verification-value",
  });
  const { plan } = await Provisioning.create({
    provider,
    requirements: [requirement],
    target: Provisioning.Target.ExactZone({ zone }),
  });

  const approved = await requestApproval({
    instructions: Provisioning.renderManualInstructions(plan),
    plan,
  });
  if (!approved) return;

  const authorization = await Provisioning.authorize(plan);
  await Provisioning.apply({ authorization, plan, provider });
  await Verification.observe({
    provider: Verification.Provider.Enabled({ provider, zone }),
    record: requirement,
    resolvers: [{ id: "public", resolver }],
  });
}
