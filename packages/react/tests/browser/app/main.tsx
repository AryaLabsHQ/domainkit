/**
 * The browser fixture: `Domain.Flow` over the same fake transport the unit tests use, so the
 * Playwright run exercises the real stylesheet, portals, and focus behaviour with no host app.
 */
import { DnsRecord, Plan, Verify } from "domainkit";
import type { Transport } from "domainkit/client";
import * as DateTime from "effect/DateTime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Domain, DomainKit, Testing, Verify as VerifyUi } from "../../../src/index.ts";
// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
import "../../../src/styles.css";

const parameters = new URLSearchParams(window.location.search);
const zone = parameters.get("zone") ?? "example.com";
const domain = `app.${zone}`;
const colorScheme = parameters.get("scheme") === "dark" ? "dark" : "light";

const transport = Testing.transport({ provider: { oauth: true, zones: [zone] } });

const requirements = [
  DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
  DnsRecord.txt({
    name: `_acme.${domain}`,
    purpose: "Prove ownership",
    value: "acme-verify=7f3a",
  }),
];

/** A readiness the fake transport cannot reach on its own: a requirement observed as mismatched. */
const observedAt = DateTime.makeUnsafe("2026-09-04T10:00:00.000Z");
const mismatched: Transport.Readiness = {
  attachmentId: "attachment-1",
  checkedAt: observedAt,
  domain,
  host: [],
  nextCheckAt: null,
  overall: "pending",
  requirements: [
    {
      evidence: [
        new Verify.ProviderEvidence({
          detail: null,
          observedAt,
          provider: "fake",
          status: "mismatch",
          values: ["old.example.com"],
        }),
        new Verify.PublicDnsEvidence({
          detail: "The name resolves somewhere else.",
          observedAt,
          resolver: "cloudflare",
          status: "mismatch",
          values: ["old.example.com", "older.example.com"],
        }),
        new Verify.PublicDnsEvidence({
          detail: null,
          observedAt,
          resolver: "google",
          status: "missing",
          values: [],
        }),
      ],
      operationId: Plan.OperationId.make("op-1"),
      record: requirements[0] as DnsRecord.Model,
      status: "mismatch",
    },
  ],
};

const container = document.querySelector("#root");
if (container === null) throw new Error("The fixture has no #root");

createRoot(container).render(
  <StrictMode>
    <DomainKit.Root colorScheme={colorScheme} theme={{ accent: "#4f46e5" }} transport={transport}>
      {parameters.get("view") === "evidence" ? (
        <VerifyUi.Evidence readiness={mismatched} />
      ) : (
        <Domain.Flow domain={domain} requirements={requirements} />
      )}
    </DomainKit.Root>
  </StrictMode>,
);
