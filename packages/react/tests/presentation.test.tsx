import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DnsRecord, DomainKit as Kit, Plan, Reason } from "domainkit";
import type { Transport } from "domainkit/client";

import { Connect, DomainKit, Messages, Outcome, Provider, Records, Testing } from "../src/index.ts";

const reasons: ReadonlyArray<Reason.Model> = [
  new Reason.InvalidInput({ field: "accountId", message: "must not be empty" }),
  new Reason.Unauthenticated({ message: "bad token" }),
  new Reason.Forbidden({ message: "not yours" }),
  new Reason.NotFound({ entity: "connection", id: "c1" }),
  new Reason.Conflict({ operations: [], planId: Plan.PlanId.make("p1") }),
  new Reason.Stale({
    digest: Plan.Digest.make("d1"),
    planId: Plan.PlanId.make("p1"),
  }),
  new Reason.Expired({ entity: "approval", id: "a1" }),
  new Reason.Busy({ key: "apply:a1" }),
  new Reason.ProviderRejected({ message: "nope", provider: "fake" }),
  new Reason.ProviderUnavailable({ message: "down", provider: "fake" }),
  new Reason.ProviderConflict({ message: "exists", provider: "fake" }),
  new Reason.Unsupported({ message: "no", operation: "delete", provider: "fake" }),
  new Reason.Reconnect({ connectionId: "c1", provider: "fake" }),
  new Reason.StorageFailed({ message: "io", operation: "put" }),
  new Reason.CryptoFailed({ operation: "open" }),
  new Reason.ResolverFailed({ message: "timeout", resolver: "cloudflare" }),
];

const provider: Provider.Descriptor = {
  id: "fake",
  methods: [{ docsUrl: null, fields: null, kind: "oauth", label: "Sign in" }],
  name: "Fake DNS",
};

const transport: Transport.Interface = Testing.transport({
  capabilities: ["connection"],
  // The zone's nameservers are the fake's own, so discovery names it as the host.
  provider: { nameserverSuffixes: ["example.com"], zones: ["example.com"] },
});

const user = userEvent.setup({ delay: null });

describe("Messages", () => {
  it("renders a sentence for every failure reason and never its tag", () => {
    for (const reason of reasons) {
      const text = Messages.failure(new Kit.Error({ reason }), Messages.english);
      // A reason never reaches a customer as its own tag; it reaches them as a sentence.
      expect(text).not.toBe(reason._tag);
      expect(text).toMatch(/\s/);
    }
  });

  it("gives every failure reason a title and a description written for the customer", () => {
    for (const reason of reasons) {
      const words = Messages.outcome(new Kit.Error({ reason }), Messages.english);
      expect(words.title).not.toBe(reason._tag);
      expect(words.title.length).toBeGreaterThan(0);
      expect(words.description.length).toBeGreaterThan(0);
      // A title is a heading, so it carries no full stop.
      expect(words.title.endsWith(".")).toBe(false);
    }
  });

  it("names the provider the customer acted on when the reason cannot", () => {
    const error = new Kit.Error({ reason: new Reason.Unauthenticated({ message: "bad token" }) });
    expect(Messages.outcome(error, Messages.english, { provider: "Cloudflare" }).title).toBe(
      "Cloudflare didn't accept this token",
    );
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

  it("takes host overrides for any key", async () => {
    render(
      <DomainKit.Root messages={{ connect: "Link DNS" }} transport={transport}>
        <Connect.Flow domain="app.example.com" />
      </DomainKit.Root>,
    );
    // The prompt waits for discovery rather than flashing a trigger it may not offer.
    expect(await screen.findByRole("button", { name: "Link DNS" })).toBeDefined();
  });
});

describe("Outcome", () => {
  const failing = () => {
    const controller = Connect.useController({ domain: "app.outcome.example" });
    return controller;
  };

  it("renders media, title, description, and the retry as one composition", async () => {
    function Panel() {
      const controller = failing();
      return (
        <>
          <button
            onClick={() =>
              controller.connect({ method: "token", provider: "absent", values: { token: "x" } })
            }
            type="button"
          >
            go
          </button>
          <Connect.Outcome controller={controller} />
        </>
      );
    }
    render(
      <DomainKit.Root transport={transport}>
        <Panel />
      </DomainKit.Root>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-domainkit-part")).toBe("outcome");
    expect(alert.getAttribute("data-layout")).toBe("card");
    expect(alert.getAttribute("data-tone")).toBe("danger");
    for (const part of ["outcome-media", "outcome-title", "outcome-description", "outcome-content"])
      expect(alert.querySelector(`[data-domainkit-part='${part}']`)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("keeps the catalog's words when a host brings its own media and layout", async () => {
    function Panel() {
      const controller = failing();
      return (
        <>
          <button
            onClick={() =>
              controller.connect({ method: "token", provider: "absent", values: { token: "x" } })
            }
            type="button"
          >
            go
          </button>
          <Connect.Outcome controller={controller} layout="inline">
            <Outcome.Media>
              <span data-testid="host-media" />
            </Outcome.Media>
            <Outcome.Title />
            <Outcome.Description />
            <Outcome.Content />
          </Connect.Outcome>
        </>
      );
    }
    render(
      <DomainKit.Root transport={transport}>
        <Panel />
      </DomainKit.Root>,
    );
    await user.click(screen.getByRole("button", { name: "go" }));
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-layout")).toBe("inline");
    expect(screen.getByTestId("host-media")).toBeDefined();
    expect(alert.querySelector("[data-domainkit-part='outcome-title']")?.textContent).toBe(
      "That provider no longer exists",
    );
    expect(alert.querySelector("[data-domainkit-part='outcome-header']")).toBeNull();
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
