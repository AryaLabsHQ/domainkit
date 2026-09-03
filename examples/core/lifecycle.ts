// #region program
import { Effect } from "effect";
import { DnsRecord, Provision, Verify } from "domainkit";

const requirements = [
  DnsRecord.cname({
    name: "app.example.com",
    target: "edge.acme.dev",
    purpose: "Serve your site",
  }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

export const program = Effect.gen(function* () {
  const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
  // Create the CNAME, no-op the TXT already in place, conflict on anything incompatible,
  // and a digest over all of it for the customer to approve.

  const approval = yield* Provision.approve(plan);
  const receipt = yield* Provision.apply(approval);
  // One outcome per operation. A write that fails after an earlier one lands is a `partial`
  // receipt, not an exception, and retrying any step replays its result.

  const readiness = yield* Verify.observe({ domain: "app.example.com" });
  return { receipt, ready: readiness.overall === "ready" };
});
// #endregion program
