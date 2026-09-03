import { render, screen, within } from "@testing-library/react";
import { DnsRecord, Plan, Verify } from "domainkit";
import type { Transport } from "domainkit/client";
import * as DateTime from "effect/DateTime";

import { DomainKit, Testing, Verify as VerifyUi } from "../src/index.ts";

const observedAt = DateTime.makeUnsafe("2026-09-04T10:00:00.000Z");

const required = DnsRecord.cname({
  name: "app.evidence.example",
  purpose: "Serve your site",
  target: "edge.example.com",
});
const proven = DnsRecord.txt({ name: "_acme.app.evidence.example", value: "acme-verify=7f3a" });

/** Built from the wire constructors, so the shape is the one the transport decodes. */
const readiness: Transport.Readiness = {
  attachmentId: "attachment-1",
  checkedAt: observedAt,
  domain: "app.evidence.example",
  host: [
    new Verify.HostEvidence({
      detail: "The identity is still pending at the provider.",
      label: "Email identity",
      observedAt,
      source: "ses",
      status: "pending",
    }),
  ],
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
        new Verify.PublicDnsEvidence({
          detail: "The resolver did not answer.",
          observedAt,
          resolver: "quad9",
          status: "unknown",
          values: [],
        }),
      ],
      operationId: Plan.OperationId.make("op-1"),
      record: required,
      status: "mismatch",
    },
    {
      evidence: [
        new Verify.PublicDnsEvidence({
          detail: null,
          observedAt,
          resolver: "cloudflare",
          status: "satisfied",
          values: ["acme-verify=7f3a"],
        }),
      ],
      operationId: Plan.OperationId.make("op-2"),
      record: proven,
      status: "satisfied",
    },
  ],
};

const panel = () => {
  render(
    <DomainKit.Root transport={Testing.transport({ capabilities: ["verification"] })}>
      <VerifyUi.Evidence readiness={readiness} />
    </DomainKit.Root>,
  );
};

const groups = () =>
  [...document.querySelectorAll("[data-domainkit-part='observation-group']")] as Array<HTMLElement>;

describe("Verify.Evidence", () => {
  it("names what a failing requirement expects and what each observer read back", () => {
    panel();
    expect(screen.getByText("Expected edge.example.com")).toBeDefined();
    expect(screen.getByText("Found old.example.com")).toBeDefined();
    expect(screen.getByText("Found old.example.com, older.example.com")).toBeDefined();
    expect(screen.getByText("Found nothing")).toBeDefined();
  });

  it("shows the detail an observer supplied, and nothing when it supplied none", () => {
    panel();
    expect(screen.getByText("The name resolves somewhere else.")).toBeDefined();
    expect(screen.getByText("The identity is still pending at the provider.")).toBeDefined();
    expect(document.querySelectorAll("[data-domainkit-part='observation-note']")).toHaveLength(3);
  });

  it("says nothing about values when an observer never answered", () => {
    panel();
    // `missing` is the one observer that confirmed absence; `unknown` only failed to look.
    expect(screen.getAllByText("Found nothing")).toHaveLength(1);
    expect(document.querySelectorAll("[data-domainkit-part='observation-observed']")).toHaveLength(
      3,
    );
    expect(screen.getByText("The resolver did not answer.")).toBeDefined();
  });

  it("leaves a satisfied requirement free of expected and observed lines", () => {
    panel();
    const satisfied = groups()[1];
    if (satisfied === undefined) throw new Error("The panel rendered no second requirement");
    expect(within(satisfied).queryByText(/^Expected /)).toBeNull();
    expect(within(satisfied).queryByText(/^Found /)).toBeNull();
    expect(document.querySelectorAll("[data-domainkit-part='observation-expected']")).toHaveLength(
      1,
    );
  });
});
