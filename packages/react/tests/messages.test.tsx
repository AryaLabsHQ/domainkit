import { DnsRecord, DomainKit as Kit, Plan, Reason } from "domainkit";

import { Messages, Outcome } from "../src/index.ts";
import { mount, scenario } from "./harness.tsx";

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

describe("Messages", () => {
  it("renders a sentence for every failure reason and never its tag", () => {
    for (const reason of reasons) {
      const text = Messages.failure(new Kit.Error({ reason }), Messages.english);
      // A reason never reaches a customer as its own tag; it reaches them as a sentence.
      expect(text).not.toBe(reason._tag);
      expect(text).toMatch(/\s/);
    }
  });

  it("gives every failure reason a title written for the customer", () => {
    for (const reason of reasons) {
      const words = Messages.outcome(new Kit.Error({ reason }), Messages.english);
      expect(words.title).not.toBe(reason._tag);
      expect(words.title.length).toBeGreaterThan(0);
      // A title is a heading, so it carries no full stop.
      expect(words.title.endsWith(".")).toBe(false);
      // A reason says what to do about it, or says nothing rather than repeating its title.
      if (words.description !== undefined) expect(words.description.length).toBeGreaterThan(0);
    }
  });

  it("reads a reason with no description as one sentence", () => {
    const error = new Kit.Error({ reason: new Reason.Unauthenticated({ message: "bad token" }) });
    expect(Messages.failure(error, Messages.english)).toBe("Token not accepted.");
  });

  it("names the provider the customer acted on rather than the id the reason carries", () => {
    const error = new Kit.Error({
      reason: new Reason.ProviderUnavailable({ message: "down", provider: "cloudflare" }),
    });
    expect(Messages.outcome(error, Messages.english, { provider: "Cloudflare" }).title).toBe(
      "Cloudflare isn't responding",
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

  it("takes host overrides for any key", () => {
    const { transport } = scenario();
    const view = mount(transport, () => Messages.merge({ connect: "Link DNS" }));
    expect(view.result.current.connect).toBe("Link DNS");
    // Every other key still reads from the catalog it merged into.
    expect(view.result.current.disconnect).toBe(Messages.english.disconnect);
  });
});

describe("Outcome.useDescribe", () => {
  it("binds the catalog the root holds, so a surface passes the error alone", () => {
    const { transport } = scenario();
    const view = mount(transport, () => Outcome.useDescribe());
    const error = new Kit.Error({
      reason: new Reason.ProviderUnavailable({ message: "down", provider: "cloudflare" }),
    });
    // The reason alone cannot name the provider a customer typed a token for.
    expect(view.result.current(error, { provider: "Cloudflare" }).title).toBe(
      "Cloudflare isn't responding",
    );
    // Without one it falls back to the id the reason carries rather than inventing a name.
    expect(view.result.current(error).title).toBe("cloudflare isn't responding");
  });

  it("reads the same pair as the pure form over an explicit catalog", () => {
    const { transport } = scenario();
    const view = mount(transport, () => Outcome.useDescribe());
    for (const reason of reasons) {
      const error = new Kit.Error({ reason });
      expect(view.result.current(error)).toEqual(Outcome.describe(error, Messages.english));
    }
  });
});
