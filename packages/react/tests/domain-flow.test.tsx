import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DnsRecord, type Receipt } from "domainkit";

import { useEffect, useState } from "react";

import { Connect, Domain, DomainKit, Records, Testing } from "../src/index.ts";

/**
 * Every fake provider registers its zones in one process-wide table, so each case takes a zone of
 * its own and neither the resolver nor discovery sees another case's records.
 */
let cases = 0;
const scenario = () => {
  const zone = `case${(cases += 1)}.example`;
  const domain = `app.${zone}`;
  return {
    domain,
    requirements: [
      DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
      DnsRecord.txt({
        name: `_acme.${domain}`,
        purpose: "Prove ownership",
        value: "acme-verify=7f3a",
      }),
    ],
    transport: Testing.transport({ provider: { nameserverSuffixes: [zone], zones: [zone] } }),
  };
};

/** No inter-event delay: every keystroke re-renders the whole flow. */
const user = userEvent.setup({ delay: null });

/** A button that exists is not always ready: the review actions render disabled while planning. */
const click = async (name: string | RegExp) => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  await user.click(button);
};

const connect = async () => {
  await click("Connect");
  await user.type(await screen.findByLabelText(/Token/), "tok");
  await user.click(screen.getByRole("button", { name: "Connect with an API token" }));
  await screen.findByText("fake connected");
};

describe("Domain.Flow", () => {
  it("runs connect, plan, approve, apply, verify, and cleanup over the fake transport", async () => {
    const { domain, requirements, transport } = scenario();
    const applied: Array<Receipt.Model> = [];
    const cleaned: Array<Receipt.Model> = [];
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow
          domain={domain}
          onApplied={(receipt) => applied.push(receipt)}
          onCleaned={(receipt) => cleaned.push(receipt)}
          requirements={requirements}
        />
      </DomainKit.Root>,
    );

    await connect();

    await click("Review changes");
    await click("Approve");
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]?.status).toBe("complete");

    // The default verification slot observes on mount; opening its popover is a browser concern
    // and `tests/browser/flow.spec.ts` covers it there.
    await waitFor(() =>
      expect(transport.calls.some((call) => call.method === "verification.observe")).toBe(true),
    );

    await click("Remove records");
    await click("Approve");
    await waitFor(() => expect(cleaned).toHaveLength(1));

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
      ]),
    );
  });

  it("replaces the records slot with a host table and the rest of the flow still works", async () => {
    const { domain, requirements, transport } = scenario();
    const applied: Array<Receipt.Model> = [];
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow
          domain={domain}
          onApplied={(receipt) => applied.push(receipt)}
          requirements={requirements}
          slots={{
            records: ({ readiness, records }) => (
              <table data-testid="host-table">
                <caption>Host DNS</caption>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.name}>
                      <td>{record.name}</td>
                      <td>{DnsRecord.data(record)}</td>
                      <td>{Records.statusOf(record, readiness) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          }}
        />
      </DomainKit.Root>,
    );

    const table = await screen.findByTestId("host-table");
    expect(within(table).getByText("Host DNS")).toBeDefined();
    expect(screen.queryByRole("columnheader", { name: "Type" })).toBeNull();

    await connect();
    await click("Review changes");
    await click("Approve");
    await waitFor(() => expect(applied).toHaveLength(1));
  });

  it("renders slot output as direct children, so inlining actions needs no display: contents", async () => {
    const { domain, requirements, transport } = scenario();
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow
          domain={domain}
          requirements={requirements}
          slots={{
            actions: ({ provisioning }) => (
              <button data-testid="host-action" onClick={provisioning.plan} type="button">
                Apply DNS
              </button>
            ),
            connection: () => null,
            records: () => null,
            verification: () => null,
          }}
        />
      </DomainKit.Root>,
    );
    const action = await screen.findByTestId("host-action");
    const flow = document.querySelector("[data-domainkit-part='domain-flow']");
    expect(action.parentElement).toBe(flow);
  });

  it("renders only the capability groups the transport declares", async () => {
    const { domain, requirements } = scenario();
    const transport = Testing.transport({
      capabilities: ["connection"],
      provider: {
        nameserverSuffixes: [domain.slice(domain.indexOf(".") + 1)],
        zones: [domain.slice(domain.indexOf(".") + 1)],
      },
    });
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await screen.findByRole("button", { name: "Connect" });
    expect(screen.queryByRole("button", { name: /Check/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove records" })).toBeNull();
  });

  it("declines a plan from the default actions slot and reports the rejection", async () => {
    const { domain, requirements, transport } = scenario();
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await connect();
    await click("Review changes");
    await click("Decline");
    await waitFor(() => expect(screen.getByText(/Declined by/)).toBeDefined());
  });

  it("takes a dialog surface from the host through the connection slot's render prop", async () => {
    const { domain, requirements, transport } = scenario();
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow
          domain={domain}
          requirements={requirements}
          slots={{
            connection: ({ controller }) => (
              <Connect.Dialog
                controller={controller}
                render={({ children }) => <section data-testid="host-panel">{children}</section>}
              />
            ),
          }}
        />
      </DomainKit.Root>,
    );
    await screen.findByTestId("host-panel");
    expect(screen.getByLabelText(/Token/)).toBeDefined();
  });
});

describe("Domain.Flow read-only", () => {
  const connected = async () => {
    const scenarioed = scenario();
    await (async () => {
      const view = render(
        <DomainKit.Root transport={scenarioed.transport}>
          <Domain.Flow domain={scenarioed.domain} requirements={scenarioed.requirements} />
        </DomainKit.Root>,
      );
      await connect();
      view.unmount();
    })();
    return scenarioed;
  };

  it("keeps the state and drops every control that would change it", async () => {
    const { domain, requirements, transport } = await connected();
    render(
      <DomainKit.Root readOnly transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    // The state a member may see.
    await screen.findByText("fake connected");
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "CNAME" })).toBeDefined();
    // The writes they may not start.
    for (const name of [
      "Connect",
      "Detach domain",
      "Disconnect",
      "Review changes",
      "Approve",
      "Decline",
      "Remove records",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("states who serves the zone without offering to connect it", async () => {
    const { domain, requirements, transport } = scenario();
    render(
      <DomainKit.Root readOnly transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await screen.findByText("Owns DNS for this domain.");
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("says a domain has no provider when nothing serves its zone", async () => {
    const { domain, requirements } = scenario();
    // No nameserver suffixes: discovery finds no host, so there is nothing to name.
    const transport = Testing.transport({
      provider: { zones: [domain.slice(domain.indexOf(".") + 1)] },
    });
    render(
      <DomainKit.Root readOnly transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await screen.findByText("No DNS provider is connected.");
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("scopes the flag to one flow when the root is writable", async () => {
    const { domain, requirements, transport } = await connected();
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain={domain} readOnly requirements={requirements} />
      </DomainKit.Root>,
    );
    await screen.findByText("fake connected");
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Detach domain" })).toBeNull();
  });

  it("still offers the writes when the flag is off", async () => {
    const { domain, requirements, transport } = await connected();
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    expect(await screen.findByRole("button", { name: "Review changes" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Detach domain" })).toBeDefined();
  });
});

describe("Domain.Flow verification requirements", () => {
  const observeCalls = (transport: {
    readonly calls: ReadonlyArray<{ method: string; input: unknown }>;
  }) => transport.calls.filter((call) => call.method === "verification.observe");

  it("verifies a domain with no attachment by naming what it asked for", async () => {
    const { domain, requirements, transport } = scenario();
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await waitFor(() => expect(observeCalls(transport).length).toBeGreaterThan(0));
    // Two arguments, so the fake records the list: the domain, then what to look for.
    expect(observeCalls(transport)[0]?.input).toEqual([domain, { requirements }]);
    // Nothing is attached, so the receipt path would have failed the call outright.
    await waitFor(() => expect(screen.getByRole("button", { name: /Check/ })).toBeDefined());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("observes again when a requirement changes in a way only the wire sees", async () => {
    const { domain, requirements, transport } = scenario();
    const first = requirements[0];
    if (first === undefined) throw new Error("the scenario has no requirements");
    // Same type, name, and data; a different policy, which is what readiness turns on.
    const restated = [
      DnsRecord.cname({ name: first.name, purpose: "Serve your site", target: "edge.example.com" }),
      DnsRecord.txt({
        name: `_acme.${domain}`,
        policy: "exclusive",
        purpose: "Prove ownership",
        value: "acme-verify=7f3a",
      }),
    ];
    function Harness({ set }: { readonly set: ReadonlyArray<DnsRecord.Model> }) {
      return (
        <DomainKit.Root transport={transport}>
          <Domain.Flow domain={domain} requirements={set} />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness set={requirements} />);
    await waitFor(() => expect(observeCalls(transport)).toHaveLength(1));
    view.rerender(<Harness set={restated} />);
    await waitFor(() => expect(observeCalls(transport)).toHaveLength(2));
    expect(observeCalls(transport)[1]?.input).toEqual([domain, { requirements: restated }]);
  });

  it("does not re-observe when the host writes the requirements inline", async () => {
    const { domain, requirements, transport } = scenario();
    function Harness() {
      const [, setTick] = useState(0);
      useEffect(() => {
        setTick(1);
        setTick(2);
      }, []);
      return (
        <DomainKit.Root transport={transport}>
          <Domain.Flow domain={domain} requirements={[...requirements]} />
        </DomainKit.Root>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(observeCalls(transport).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: /Check/ })).toBeDefined());
    expect(observeCalls(transport)).toHaveLength(1);
  });
});

describe("read-only and a failed write", () => {
  it("offers no retry for a write that failed before the flow became read-only", async () => {
    const { domain, requirements, transport } = scenario();
    let controller: Connect.Controller | null = null;
    function Probe({ readOnly }: { readonly readOnly: boolean }) {
      controller = Connect.useController({ domain });
      return (
        <>
          <Connect.Outcome controller={controller} />
          <Domain.Flow domain={domain} readOnly={readOnly} requirements={requirements} />
        </>
      );
    }
    function Harness({ readOnly }: { readonly readOnly: boolean }) {
      return (
        <DomainKit.Root readOnly={readOnly} transport={transport}>
          <Probe readOnly={readOnly} />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness readOnly={false} />);
    await waitFor(() => expect(controller).not.toBeNull());
    // A write that fails while the flow is still writable.
    act(() => {
      controller?.connect({ method: "token", provider: "absent", values: { token: "x" } });
    });
    await screen.findByRole("button", { name: "Try again" });

    view.rerender(<Harness readOnly />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // The failure itself still reads.
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

    // And the verb refuses too, so a host calling it directly cannot resend the write.
    const before = transport.calls.filter((call) => call.method === "connection.start").length;
    act(() => controller?.retry());
    await waitFor(() =>
      expect(
        transport.calls.filter((call) => call.method === "connection.inspect").length,
      ).toBeGreaterThan(0),
    );
    expect(transport.calls.filter((call) => call.method === "connection.start")).toHaveLength(
      before,
    );
  });
});
