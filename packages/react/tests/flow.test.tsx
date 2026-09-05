import { act, render } from "@testing-library/react";
import { DnsRecord, Plan, type Receipt } from "domainkit";
import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";

import { Connect, Domain, DomainKit, Records, Testing } from "../src/index.ts";
import { attach, mount, run, scenario, until } from "./harness.tsx";

/** The one press the surface offers: approve every write in the plan and apply it. */
const addRecords = async (flow: Domain.Flow): Promise<void> => {
  const plan = flow.plan;
  if (plan === null) throw new Error("There was no plan to add");
  const writes = Plan.writes(plan);
  await run(() =>
    flow.provisioning.approve(
      writes.length === plan.operations.length ? undefined : writes.map((write) => write.id),
    ),
  );
};

const connect = async (flow: () => Domain.Flow): Promise<void> => {
  await until(() => expect(flow().connection.state._tag).toBe("Disconnected"));
  await run(() =>
    flow().connection.connect({ method: "token", provider: "fake", values: { token: "tok" } }),
  );
  await until(() => expect(flow().state.connected).toBe(true));
};

/** What one row reports, which is the plan while one is pending and the observation after it. */
const standing = (flow: Domain.Flow, record: DnsRecord.Model) =>
  Records.statusOf(record, { plan: flow.plan, readiness: flow.readiness });

/** How many times the transport was asked for one method, which is how a plan is counted. */
const called = (transport: Testing.RecordingTransport, method: string): number =>
  transport.calls.filter((call) => call.method === method).length;

/**
 * Delete the records an apply landed, at the provider and behind the flow's back, which is what a
 * customer does in the provider's own dashboard.
 */
const deleteAtProvider = async (
  transport: Testing.RecordingTransport,
  receiptId: Receipt.ReceiptId,
): Promise<void> => {
  const cleanup = transport.cleanup;
  if (cleanup === undefined) throw new Error("The fake transport has no cleanup group");
  await Effect.runPromise(
    Effect.gen(function* () {
      const plan = yield* cleanup.plan(receiptId);
      const approval = yield* cleanup.approve({ planId: plan.id });
      yield* cleanup.apply(approval.id);
    }),
  );
};

/**
 * Check now, and wait for the answer that press asked for. Readiness stays on screen while a new
 * observation runs, so a different one is the new answer having landed.
 */
const checkNow = async (flow: () => Domain.Flow): Promise<void> => {
  const previous = flow().readiness;
  await run(() => flow().verification.observe());
  await until(() => expect(flow().readiness).not.toBe(previous));
};

/** The receipt a flow's latest apply produced, once the surface can read it. */
const receiptOf = async (flow: () => Domain.Flow): Promise<Receipt.ReceiptId> => {
  await until(() => expect(flow().connection.receipt).not.toBeNull());
  const receiptId = flow().state.receiptId;
  if (receiptId === null) throw new Error("The apply left no receipt");
  return receiptId;
};

describe("Domain.useFlow", () => {
  it("runs connect, plan, apply, observe, and cleanup over the fake transport", async () => {
    const { domain, requirements, transport } = scenario();
    const applied: Array<Receipt.Model> = [];
    const cleaned: Array<Receipt.Model> = [];
    const view = mount(transport, () =>
      Domain.useFlow({
        domain,
        onApplied: (receipt) => applied.push(receipt),
        onCleaned: (receipt) => cleaned.push(receipt),
        requirements,
      }),
    );
    const flow = () => view.result.current;

    await connect(flow);
    // The plan builds itself on the connection, so the rows say what will happen before anything
    // does, and one press is what does it.
    await until(() => expect(flow().plan?.operations).toHaveLength(2));
    const [first] = requirements;
    if (first === undefined) throw new Error("The scenario asked for no records");
    expect(standing(flow(), first)).toMatchObject({ _tag: "Operation" });
    await addRecords(flow());
    await until(() => expect(applied).toHaveLength(1));
    expect(applied[0]?.status).toBe("complete");
    await until(() => expect(flow().state.applied).toBe(true));

    // Verification observes on mount and again when the flow re-reads the domain.
    await until(() =>
      expect(transport.calls.some((call) => call.method === "verification.observe")).toBe(true),
    );

    // Removing the records DomainKit added is bound to the receipt the apply produced.
    await run(() => flow().cleanup.plan());
    await until(() => expect(flow().cleanup.state._tag).toBe("Planned"));
    await run(() => flow().cleanup.approve());
    await until(() => expect(cleaned).toHaveLength(1));
    await run(() => flow().connection.disconnect());
    await until(() => expect(flow().state.connected).toBe(false));

    expect(transport.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining([
        "connection.inspect",
        "connection.discover",
        "connection.start",
        "provisioning.plan",
        "provisioning.approve",
        "provisioning.apply",
        "verification.observe",
        "cleanup.plan",
        "cleanup.approve",
        "cleanup.apply",
        "connection.disconnect",
      ]),
    );
  });

  it("reports only the capability groups the transport declares", async () => {
    const { domain, requirements, transport } = scenario({ capabilities: ["connection"] });
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    await until(() => expect(view.result.current.state.connection).toBe("Disconnected"));
    expect(view.result.current.capabilities).toEqual(["connection"]);
    // Nothing plans and nothing observes when the host declares neither group.
    expect(view.result.current.plan).toBeNull();
    expect(view.result.current.readiness).toBeNull();
    expect(transport.calls.every((call) => call.method.startsWith("connection."))).toBe(true);
  });

  it("attaches the domain to the connection that already serves its zone", async () => {
    const { domain, requirements, sibling, transport, zone } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () =>
      Domain.useFlow({ domain: sibling, requirements: [...requirements] }),
    );
    // The account the customer already granted covers this domain too, so nothing is asked twice.
    await until(() => expect(view.result.current.state.connected).toBe(true));
    expect(view.result.current.state.label).toBe(zone);
    expect(transport.calls.some((call) => call.method === "connection.attach")).toBe(true);
  });

  it("leaves a read-only surface disconnected rather than attaching for the customer", async () => {
    const { requirements, sibling, transport } = scenario();
    await attach(transport);
    const view = mount(
      transport,
      () => Domain.useFlow({ domain: sibling, requirements: [...requirements] }),
      { readOnly: true },
    );
    await until(() => expect(view.result.current.state.connection).toBe("Disconnected"));
    // The state says why the surface offers nothing, so a host can explain it.
    expect(view.result.current.state.readOnly).toBe(true);
    expect(transport.calls.some((call) => call.method === "connection.attach")).toBe(false);
  });

  it("plans as soon as the domain is attached with nothing applied, and once per reason", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    const flow = () => view.result.current;
    await connect(flow);
    await until(() => expect(flow().plan).not.toBeNull());
    const plans = () =>
      transport.calls.filter((call) => call.method === "provisioning.plan").length;
    expect(plans()).toBe(1);
    // Re-rendering is not a reason to plan again: the signature is the domain, the connection
    // that landed, the receipt, and what the host asked for.
    view.rerender();
    view.rerender();
    expect(plans()).toBe(1);
  });

  it("does not plan again while an applied domain still holds every record", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    const flow = () => view.result.current;
    await connect(flow);
    await until(() => expect(flow().plan).not.toBeNull());
    await addRecords(flow());
    await receiptOf(flow);
    const plans = called(transport, "provisioning.plan");
    // The observation on screen was read before the apply, so it reports the records missing
    // because they were. Evidence older than the receipt is no reason to plan again.
    expect(flow().readiness?.overall).toBe("pending");
    expect(flow().plan).toBeNull();
    expect(called(transport, "provisioning.plan")).toBe(plans);
    // The check that follows an apply reads every record back, so there is nothing to add.
    await checkNow(flow);
    await until(() => expect(flow().readiness?.overall).toBe("ready"));
    view.rerender();
    expect(called(transport, "provisioning.plan")).toBe(plans);
    expect(flow().plan).toBeNull();
  });

  it("plans again when the records an apply landed are deleted at the provider", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    const flow = () => view.result.current;
    await connect(flow);
    await until(() => expect(flow().plan).not.toBeNull());
    await addRecords(flow());
    const receiptId = await receiptOf(flow);
    await checkNow(flow);
    await until(() => expect(flow().readiness?.overall).toBe("ready"));
    const plans = called(transport, "provisioning.plan");

    await deleteAtProvider(transport, receiptId);
    await checkNow(flow);
    // The records are gone, so the surface offers them again instead of a count of what landed.
    await until(() => expect(flow().plan?.operations).toHaveLength(2));
    const plan = flow().plan;
    if (plan === null) throw new Error("The drift built no plan");
    expect(Plan.writes(plan)).toHaveLength(2);
    expect(called(transport, "provisioning.plan")).toBe(plans + 1);
    const [first] = requirements;
    if (first === undefined) throw new Error("The scenario asked for no records");
    expect(standing(flow(), first)).toMatchObject({ _tag: "Operation" });
    // The receipt is still the proof of what was applied, so cleanup keeps its offer.
    expect(flow().state.applied).toBe(true);

    // The same drift on the next check is the same reason to plan, so it plans once, not once
    // per poll.
    await checkNow(flow);
    await checkNow(flow);
    expect(called(transport, "provisioning.plan")).toBe(plans + 1);
  });

  it("records the second apply and cleans up from the receipt it left", async () => {
    const { domain, requirements, transport } = scenario();
    const cleaned: Array<Receipt.Model> = [];
    const view = mount(transport, () =>
      Domain.useFlow({ domain, onCleaned: (receipt) => cleaned.push(receipt), requirements }),
    );
    const flow = () => view.result.current;
    await connect(flow);
    await until(() => expect(flow().plan).not.toBeNull());
    await addRecords(flow());
    const first = await receiptOf(flow);
    await deleteAtProvider(transport, first);
    await checkNow(flow);
    await until(() => expect(flow().plan).not.toBeNull());
    await addRecords(flow());
    await until(() => expect(flow().state.receiptId).not.toBe(first));
    const second = await receiptOf(flow);

    // Cleanup undoes the apply that actually put the records there, which is the latest one.
    await run(() => flow().cleanup.plan());
    await until(() => expect(flow().cleanup.state._tag).toBe("Planned"));
    expect(transport.calls.filter((call) => call.method === "cleanup.plan").at(-1)?.input).toBe(
      second,
    );
    await run(() => flow().cleanup.approve());
    await until(() => expect(cleaned).toHaveLength(1));
    expect(cleaned[0]?.status).toBe("complete");

    // Records the customer had removed are not drift: the flow does not offer them straight back.
    const plans = called(transport, "provisioning.plan");
    await checkNow(flow);
    expect(called(transport, "provisioning.plan")).toBe(plans);
  });

  it("adds what it can when a record is in the way, and reports the blocker on its row", async () => {
    const zone = "conflict-flow.example";
    const domain = `app.${zone}`;
    const blocked = DnsRecord.cname({
      name: domain,
      purpose: "Serve your site",
      target: "edge.example.com",
    });
    const free = DnsRecord.txt({
      name: `_acme.${domain}`,
      purpose: "Prove ownership",
      value: "acme-verify=7f3a",
    });
    // A record already at the name the CNAME wants, which planning reports as a conflict.
    const transport = Testing.transport({
      provider: {
        nameserverSuffixes: [zone],
        records: [
          {
            record: DnsRecord.txt({ name: domain, purpose: "Something else", value: "held" }),
            zone,
          },
        ],
        zones: [zone],
      },
    });
    const view = mount(transport, () => Domain.useFlow({ domain, requirements: [blocked, free] }));
    const flow = () => view.result.current;
    await connect(flow);
    await until(() => expect(flow().plan?.operations).toHaveLength(2));
    const plan = flow().plan;
    if (plan === null) throw new Error("There was no plan to read");
    // The blocked record is not a write, so the surface offers the rest.
    expect(Plan.writes(plan)).toHaveLength(1);
    expect(Plan.conflicts(plan)).toHaveLength(1);
    const held = standing(flow(), blocked);
    expect(held?._tag).toBe("Operation");
    if (held?._tag !== "Operation") throw new Error("The blocked record reported no operation");
    expect(held.operation._tag).toBe("Conflict");
    await addRecords(flow());
    await until(() => expect(flow().state.applied).toBe(true));
  });

  it("names the account from the attachment and the receipt it applied", async () => {
    const { domain, requirements, transport, zone } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    const flow = () => view.result.current;
    await connect(flow);
    await until(() => expect(flow().state.label).toBe(zone));
    expect(flow().state.provider).toBe("fake");
    expect(flow().state.applied).toBe(false);
    await until(() => expect(flow().plan).not.toBeNull());
    await addRecords(flow());
    await until(() => expect(flow().state.applied).toBe(true));
    // The count a surface names comes off the receipt, which is the only proof of what was added.
    await until(() => expect(flow().connection.receipt).not.toBeNull());
  });

  it("keeps saying it holds the connection while a disconnect is in flight", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    const flow = () => view.result.current;
    await connect(flow);
    act(() => flow().connection.disconnect());
    // Mid-command the surface must not flip to an offer: the two never disagree.
    expect(flow().state.connected).toBe(true);
    expect(flow().state.offering).toBe(false);
    await until(() => expect(flow().state.connected).toBe(false));
  });

  it("offers nothing with connect=never and still reports a connection it holds", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ connect: "never", domain, requirements }));
    const flow = () => view.result.current;
    await until(() => expect(flow().connection.state._tag).toBe("Disconnected"));
    expect(flow().state.offering).toBe(false);
    expect(flow().invitation).toBe("never");
    await run(() =>
      flow().connection.connect({ method: "token", provider: "fake", values: { token: "tok" } }),
    );
    await until(() => expect(flow().state.connected).toBe(true));
  });

  it("verifies a domain with no attachment by naming what it asked for", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }));
    await until(() =>
      expect(transport.calls.some((call) => call.method === "verification.observe")).toBe(true),
    );
    const observed = transport.calls.find((call) => call.method === "verification.observe");
    expect(observed?.input).toMatchObject([domain, { requirements: expect.anything() }]);
    await until(() => expect(view.result.current.readiness).not.toBeNull());
  });

  it("does not observe again when the host writes the requirements inline", async () => {
    const { domain, requirements, transport } = scenario();
    function Probe() {
      Domain.useFlow({ domain, requirements: [...requirements] });
      return null;
    }
    const view = render(
      <DomainKit.Root transport={transport}>
        <Probe />
      </DomainKit.Root>,
    );
    const observations = () =>
      transport.calls.filter((call) => call.method === "verification.observe").length;
    await until(() => expect(observations()).toBe(1));
    view.rerender(
      <DomainKit.Root transport={transport}>
        <Probe />
      </DomainKit.Root>,
    );
    expect(observations()).toBe(1);
  });

  it("drops one domain's plan when the flow is pointed at another", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) => Domain.useFlow({ domain: target, requirements }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.plan).not.toBeNull());
    act(() => view.rerender({ target: sibling }));
    // A plan built for one domain must never be approved for another.
    expect(view.result.current.plan).toBeNull();
    expect(view.result.current.domain).toBe(sibling);
  });

  it("keeps a read-only flow from planning or retrying a write", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }), {
      readOnly: true,
    });
    await until(() => expect(view.result.current.state.connected).toBe(true));
    expect(view.result.current.state.readOnly).toBe(true);
    expect(transport.calls.some((call) => call.method === "provisioning.plan")).toBe(false);
    // A retry is a write too, so read-only re-inspects instead of resending the last command.
    await run(() => view.result.current.connection.retry());
    await until(() =>
      expect(
        transport.calls.filter((call) => call.method === "connection.inspect").length,
      ).toBeGreaterThan(1),
    );
  });

  it("scopes read-only to one flow when the root is writable", async () => {
    const { domain, requirements, transport } = scenario();
    const view = mount(transport, () => Domain.useFlow({ domain, readOnly: true, requirements }));
    await until(() => expect(view.result.current.state.connection).toBe("Disconnected"));
    expect(view.result.current.state.readOnly).toBe(true);
    // The flag reaches the controllers, so a command a host renders anyway is refused rather
    // than hidden: the markup is the host's, and the refusal cannot live in it.
    await run(() =>
      view.result.current.connection.connect({
        method: "token",
        provider: "fake",
        values: { token: "tok" },
      }),
    );
    await run(() => view.result.current.provisioning.plan());
    await run(() => view.result.current.cleanup.plan());
    expect(transport.calls.map((call) => call.method)).toEqual(
      expect.not.arrayContaining(["connection.start", "provisioning.plan", "cleanup.plan"]),
    );
    expect(DomainKit).toBeDefined();
  });

  it("refuses every command that changes a read-only domain", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () => Domain.useFlow({ domain, requirements }), {
      readOnly: true,
    });
    await until(() => expect(view.result.current.state.connected).toBe(true));
    const before = transport.calls.length;
    await run(() => view.result.current.connection.detach());
    await run(() => view.result.current.connection.disconnect());
    await run(() =>
      view.result.current.connection.reuse({ connectionId: "whatever", zone: "whatever" }),
    );
    await run(() => view.result.current.provisioning.approve());
    await run(() => view.result.current.provisioning.reject("no"));
    await run(() => view.result.current.provisioning.apply());
    expect(transport.calls.slice(before)).toEqual([]);
    // Observing is a read, so it stays available to a customer who may only look.
    await until(() => expect(view.result.current.readiness).not.toBeNull());
  });

  it("plans again for a domain it planned for before the flow moved away", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    // A domain in nobody's zone: no host, no attachment, so there is nothing to plan for it.
    const elsewhere = "app.unserved.example";
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) => Domain.useFlow({ domain: target, requirements }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.plan).not.toBeNull());
    const plans = () =>
      transport.calls.filter((call) => call.method === "provisioning.plan").length;
    const first = plans();
    act(() => view.rerender({ target: elsewhere }));
    await until(() => expect(view.result.current.state.connection).toBe("Disconnected"));
    expect(view.result.current.plan).toBeNull();
    // Coming back must not leave the attached domain idle with nothing to add.
    act(() => view.rerender({ target: domain }));
    await until(() => expect(plans()).toBeGreaterThan(first));
    await until(() => expect(view.result.current.plan).not.toBeNull());
  });

  it("spends the return marker on the load that came back, however it went", async () => {
    const zone = "returning.example";
    const domain = `app.${zone}`;
    const requirements = [
      DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
    ];
    const transport = Testing.transport({
      provider: { nameserverSuffixes: [zone], oauth: true, zones: [zone] },
    });
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    const redirecting: Transport.Interface = {
      ...transport,
      connection: {
        ...connection,
        start: (input) =>
          input.method._tag === "Token"
            ? connection.start(input)
            : Effect.succeed<Transport.Started>({
                _tag: "Redirect",
                authorizationUrl: "https://provider.test/consent",
              }),
      },
    };
    const first = mount(redirecting, () => Domain.useFlow({ domain, requirements }), {
      navigate: () => {},
    });
    await until(() => expect(first.result.current.connection.providers).toHaveLength(1));
    await run(() => first.result.current.connection.connect({ method: "oauth", provider: "fake" }));
    await until(() => expect(sessionStorage.getItem("domainkit.returning")).toBe(domain));
    first.unmount();

    // The customer abandoned the authorization, so the load that follows finds nothing connected
    // and still spends the marker: an ordinary page view weeks later must not read as a return.
    const back = mount(transport, () => Domain.useFlow({ domain, requirements }));
    await until(() => expect(back.result.current.connection.state._tag).toBe("Disconnected"));
    expect(sessionStorage.getItem("domainkit.returning")).toBeNull();
    expect(Connect.offering(back.result.current.connection)).toBe(true);
  });
});
