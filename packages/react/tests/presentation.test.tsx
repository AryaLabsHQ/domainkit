import { render, screen } from "@testing-library/react";
import { DnsRecord, DomainKitError, Plan } from "domainkit";
import type { Transport } from "domainkit/client";

import { Connect, DomainKit, Messages, Provider, Records, Testing } from "../src/index.ts";

const reasons: ReadonlyArray<DomainKitError.Reason> = [
  new DomainKitError.InvalidInput({ field: "accountId", message: "must not be empty" }),
  new DomainKitError.Unauthenticated({ message: "bad token" }),
  new DomainKitError.Forbidden({ message: "not yours" }),
  new DomainKitError.NotFound({ entity: "connection", id: "c1" }),
  new DomainKitError.Conflict({ operations: [], planId: Plan.PlanId.make("p1") }),
  new DomainKitError.Stale({
    digest: Plan.Digest.make("d1"),
    planId: Plan.PlanId.make("p1"),
  }),
  new DomainKitError.Expired({ entity: "approval", id: "a1" }),
  new DomainKitError.Busy({ key: "apply:a1" }),
  new DomainKitError.ProviderRejected({ message: "nope", provider: "fake" }),
  new DomainKitError.ProviderUnavailable({ message: "down", provider: "fake" }),
  new DomainKitError.ProviderConflict({ message: "exists", provider: "fake" }),
  new DomainKitError.Unsupported({ message: "no", operation: "delete", provider: "fake" }),
  new DomainKitError.Reconnect({ connectionId: "c1", provider: "fake" }),
  new DomainKitError.StorageFailed({ message: "io", operation: "put" }),
  new DomainKitError.CryptoFailed({ operation: "open" }),
  new DomainKitError.ResolverFailed({ message: "timeout", resolver: "cloudflare" }),
];

const provider: Provider.Descriptor = {
  id: "fake",
  methods: [{ docsUrl: null, fields: null, kind: "oauth", label: "Sign in" }],
  name: "Fake DNS",
};

const transport: Transport.Transport = Testing.transport({ capabilities: ["connection"] });

describe("Messages", () => {
  it("renders a sentence for every DomainKitError reason and never its tag", () => {
    for (const reason of reasons) {
      const text = Messages.failure(
        new DomainKitError.DomainKitError({ reason }),
        Messages.english,
      );
      // A reason never reaches a customer as its own tag; it reaches them as a sentence.
      expect(text).not.toBe(reason._tag);
      expect(text).toMatch(/\s/);
    }
  });

  it("names every plan operation, conflict reason, and attempt status", () => {
    const record = DnsRecord.txt({ name: "app.example.com", value: "v" });
    const operations: ReadonlyArray<Plan.Operation> = [
      new Plan.Create({ id: Plan.OperationId.make("o1"), record }),
      new Plan.Noop({
        existing: record,
        id: Plan.OperationId.make("o2"),
        record,
        ttlDrift: false,
      }),
      new Plan.Conflict({
        existing: [],
        id: Plan.OperationId.make("o3"),
        reason: "cname-collision",
        record,
      }),
      new Plan.Delete({
        id: Plan.OperationId.make("o4"),
        providerRecordId: "r1",
        record,
      }),
    ];
    for (const operation of operations) {
      expect(Messages.english.operation(operation)).not.toBe(operation._tag);
    }
    for (const reason of [
      "exclusive-name",
      "cname-collision",
      "value-mismatch",
      "opaque",
      "missing",
    ] as const) {
      expect(Messages.english.conflictReason(reason)).not.toBe(reason);
    }
    for (const status of [
      "planned",
      "approved",
      "applying",
      "complete",
      "partial",
      "failed",
      "expired",
      "rejected",
    ] as const) {
      expect(Messages.english.attemptStatus(status).length).toBeGreaterThan(0);
    }
  });

  it("takes host overrides for any key", () => {
    render(
      <DomainKit.Root messages={{ connect: "Link DNS" }} transport={transport}>
        <Connect.Flow domain="app.messages.example" />
      </DomainKit.Root>,
    );
    expect(screen.getByRole("button", { name: "Link DNS" })).toBeDefined();
  });
});

describe("Icons", () => {
  it("comes from one context, with no per-part icon props", () => {
    render(
      <DomainKit.Root icons={{ copy: <span data-testid="host-copy" /> }} transport={transport}>
        <Records.CopyValue value="edge.example.com" />
      </DomainKit.Root>,
    );
    expect(screen.getAllByTestId("host-copy").length).toBeGreaterThan(0);
  });
});

describe("Provider.Mark", () => {
  it("uses the host's mark when there is one", () => {
    render(
      <DomainKit.Root
        marks={{ fake: <img alt="" data-testid="host-mark" src="/fake.svg" /> }}
        transport={transport}
      >
        <Provider.Mark provider={provider} />
      </DomainKit.Root>,
    );
    expect(screen.getByTestId("host-mark")).toBeDefined();
  });

  it("falls back to the provider's initial without fetching anything", () => {
    render(
      <DomainKit.Root transport={transport}>
        <Provider.Mark provider={provider} />
      </DomainKit.Root>,
    );
    const mark = screen.getByRole("img", { name: "Fake DNS" });
    expect(mark.textContent).toBe("F");
    expect(mark.querySelector("img")).toBeNull();
  });
});
