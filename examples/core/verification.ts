import { DateTime, Effect } from "effect";
import { DnsRecord, Verify } from "domainkit";

const domain = "app.example.com";

// #region observe
/**
 * One call reads the provider through the attachment's session and the public pool through
 * `Resolver`, stores readiness per requirement, and says when to look again.
 */
export const check = Effect.map(Verify.observe({ domain }), (readiness) => ({
  ready: readiness.overall === "ready",
  nextCheckAt: readiness.nextCheckAt,
  pending: readiness.requirements
    .filter((requirement) => requirement.status !== "satisfied")
    .map((requirement) => `${requirement.record._tag} ${requirement.record.name}`),
}));
// #endregion observe

// #region evidence
/**
 * Every requirement keeps the evidence behind its status, one entry per source that answered.
 * `values` is what that source returned for the record's name and type, empty when it returned
 * nothing; `detail` is null when satisfied and otherwise says what went wrong.
 */
export const sources = Effect.map(Verify.observe({ domain }), (readiness) =>
  readiness.requirements.flatMap((requirement) =>
    requirement.evidence.map((evidence) => ({
      record: requirement.record.name,
      status: requirement.status,
      source:
        evidence._tag === "Provider"
          ? evidence.provider
          : evidence._tag === "PublicDns"
            ? evidence.resolver
            : evidence.source,
      found: evidence._tag === "Host" ? [] : evidence.values,
      detail: evidence.detail,
    })),
  ),
);
// #endregion evidence

// #region requirements
/** Requirements default to the latest apply receipt; pass a set to watch something else. */
export const watchOne = Verify.observe({
  domain,
  requirements: [DnsRecord.txt({ name: `_acme.${domain}`, value: "acme-verify=7f3a" })],
});
// #endregion requirements

// #region host-evidence
/** Merge what only your app can see — an email identity, a certificate — without re-reading DNS. */
export const recordCertificate = Effect.gen(function* () {
  const observedAt = yield* DateTime.now;
  return yield* Verify.attachEvidence({
    domain,
    evidence: [
      new Verify.HostEvidence({
        source: "edge-certificate",
        status: "pending",
        label: "TLS certificate",
        detail: "Issuance starts once the CNAME resolves",
        observedAt,
      }),
    ],
  });
});
// #endregion host-evidence

// #region polling
/** Readiness carries its own schedule, so a worker sleeps until `nextCheckAt` instead of polling. */
export const dueAt = Effect.map(
  Verify.latest(domain),
  (readiness) => readiness?.nextCheckAt ?? null,
);
// #endregion polling

// #region policy
/** Quorum and the backoff ladder are references with defaults; override either per call tree. */
export const strict = check.pipe(
  Effect.provideService(Verify.Policy, {
    ...Verify.defaults,
    quorum: "all",
    backoff: (pendingForMs) => (pendingForMs < 60_000 ? 5_000 : 60_000),
  }),
);
// #endregion policy
