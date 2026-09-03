import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DnsRecord, type Receipt } from "domainkit";

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
    transport: Testing.transport({ provider: { zones: [zone] } }),
  };
};

/** A button that exists is not always ready: the review actions render disabled while planning. */
const click = async (name: string | RegExp) => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  await userEvent.click(button);
};

const connect = async () => {
  await click("Connect");
  await userEvent.type(await screen.findByLabelText(/Token/), "secret-token");
  await userEvent.click(screen.getByRole("button", { name: "Token (fake)" }));
  await screen.findByText("fake connected");
};

describe("Domain.Flow", () => {
  it(
    "runs connect, plan, approve, apply, verify, and cleanup over the fake transport",
    { timeout: 20000 },
    async () => {
      const { domain, requirements, transport } = scenario();
      const applied: Array<Receipt.Receipt> = [];
      const cleaned: Array<Receipt.Receipt> = [];
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

      await click(/Check/);
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
    },
  );

  it("replaces the records slot with a host table and the rest of the flow still works", async () => {
    const { domain, requirements, transport } = scenario();
    const applied: Array<Receipt.Receipt> = [];
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
      provider: { zones: [domain.slice(domain.indexOf(".") + 1)] },
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
