// Plan, approve, apply. Plans are additive and fail closed; conflicts are data, not surprises.
import { Effect, Match } from "effect";
import { Connect, DnsRecord, DomainKit, Principal, Provision, Verify } from "domainkit";
import { Testing } from "domainkit/testing";

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

const program = Effect.gen(function* () {
  const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
  //    ^ operations: [Create CNAME, Noop TXT] with a digest the customer approves

  const approval = yield* Provision.approve(plan);
  const receipt = yield* Provision.apply(approval);
  //    ^ status: "complete" | "partial", one outcome per operation, safe to retry

  const readiness = yield* Verify.observe({ domain: "app.example.com" });
  return { receipt, ready: readiness.overall === "ready", nextCheckAt: readiness.nextCheckAt };
}).pipe(
  Effect.catchTag("DomainKitError", (error) =>
    Match.value(error.reason).pipe(
      Match.tag("Conflict", ({ operations }) =>
        Effect.fail(`Fix ${operations.length} conflicting record(s) first`),
      ),
      Match.tag("Stale", () => Effect.fail("Provider changed under us; plan again")),
      Match.orElse(() => Effect.fail(error.message)),
    ),
  ),
);

// A fake provider already holding the TXT record, so the plan shows one Create and one Noop.
const fake = Testing.provider({
  zones: ["example.com"],
  records: [
    {
      zone: "example.com",
      record: requirements[1] ?? DnsRecord.txt({ name: "x.example.com", value: "x" }),
    },
  ],
});

// The customer connected the provider earlier (a token here; OAuth returns a redirect instead).
const connected = Connect.start({
  provider: fake.id,
  method: Connect.Method.token("playground-token"),
  domain: "app.example.com",
});

export const main = connected.pipe(
  Effect.andThen(program),
  Effect.provideService(Principal.Service, { ownerId: "org_42", actorId: "user_7" }),
  Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() })),
);

if (import.meta.main) {
  console.log(JSON.stringify(await Effect.runPromise(main), null, 2));
}
