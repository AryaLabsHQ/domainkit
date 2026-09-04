import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DnsRecord } from "domainkit";
import type { Transport } from "domainkit/client";
import { useEffect, useState, type ReactNode } from "react";

import { Cleanup, Connect, DomainKit, Provision, Testing, Verify } from "../src/index.ts";

/** One zone per case: fake providers share a process-wide zone table. */
let cases = 0;
const scenario = (
  options: { readonly capabilities?: ReadonlyArray<Transport.Capability> } = {},
) => {
  const zone = `unit${(cases += 1)}.example`;
  const domain = `app.${zone}`;
  return {
    domain,
    requirements: [
      DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
    ],
    sibling: `mail.${zone}`,
    transport: Testing.transport({
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      provider: { zones: [zone] },
    }),
    zone,
  };
};

const wrap = (transport: Transport.Interface) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <DomainKit.Root transport={transport}>{children}</DomainKit.Root>;
  };

/** No inter-event delay: every keystroke re-renders the whole flow. */
const user = userEvent.setup({ delay: null });

/** A button that exists is not always ready: the review actions render disabled while planning. */
const click = async (name: string | RegExp) => {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  await user.click(button);
};

/** Connect a domain with the fake provider's token method and wait for the snapshot. */
const connectDomain = async (transport: Transport.Interface, domain: string) => {
  const view = render(
    <DomainKit.Root transport={transport}>
      <Connect.Flow domain={domain} />
    </DomainKit.Root>,
  );
  await screen.findByRole("button", { name: "Connect" });
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await user.type(await screen.findByLabelText(/Token/), "tok");
  await user.click(screen.getByRole("button", { name: "Token (fake)" }));
  await waitFor(() => expect(screen.getByText("fake connected")).toBeDefined());
  view.unmount();
};

/** Observation needs a receipt, so a domain under test is connected and applied first. */
const applyDomain = async (
  transport: Transport.Interface,
  domain: string,
  requirements: ReadonlyArray<DnsRecord.Model>,
) => {
  await connectDomain(transport, domain);
  const view = render(
    <DomainKit.Root transport={transport}>
      <Provision.Flow domain={domain} requirements={requirements} />
    </DomainKit.Root>,
  );
  await click("Review changes");
  await click("Approve");
  await screen.findByText("DNS records added.");
  view.unmount();
};

describe("DomainKit.Root", () => {
  it("keeps transport identity across renders, so an inline value does not restart controllers", async () => {
    const { domain, transport: base } = scenario();
    const { calls, ...groups } = base;
    function Harness() {
      const [, setTick] = useState(0);
      useEffect(() => {
        setTick(1);
        setTick(2);
      }, []);
      // A new object every render: exactly what writing the transport inline in JSX produces.
      return (
        <DomainKit.Root transport={{ ...groups }}>
          <Connect.Flow domain={domain} />
        </DomainKit.Root>
      );
    }
    render(<Harness />);
    await screen.findByRole("button", { name: "Connect" });
    await waitFor(() =>
      expect(calls.filter((call) => call.method === "connection.inspect")).toHaveLength(1),
    );
    expect(calls.filter((call) => call.method === "connection.inspect")).toHaveLength(1);
  });

  it("exposes the transport and the capabilities the host declared", async () => {
    const { transport } = scenario({ capabilities: ["connection", "verification"] });
    function Probe() {
      const held = DomainKit.useTransport();
      return <output>{Object.keys(held).sort().join(",")}</output>;
    }
    render(
      <DomainKit.Root transport={transport}>
        <Probe />
      </DomainKit.Root>,
    );
    expect(screen.getByRole("status").textContent).toBe("connection,verification");
  });
});

describe("Connect.useController", () => {
  it("renders the token fields the provider declares and connects with their values", async () => {
    const { domain, transport } = scenario();
    render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    const field = await screen.findByLabelText(/Token/);
    expect(field.getAttribute("type")).toBe("password");
    expect(field.getAttribute("name")).toBe("token");
    await user.type(field, "tok");
    await user.click(screen.getByRole("button", { name: "Token (fake)" }));
    await waitFor(() => expect(screen.getByText("fake connected")).toBeDefined());
    const start = transport.calls.find((call) => call.method === "connection.start");
    expect(start?.input).toMatchObject({
      domain,
      method: { _tag: "Token", values: { token: "tok" } },
      provider: "fake",
    });
  });

  it("renders a failure from the error's reason, never from its tag", async () => {
    const { domain, transport } = scenario();
    function Panel() {
      const controller = Connect.useController({ domain });
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
    render(<Panel />, { wrapper: wrap(transport) });
    await user.click(screen.getByRole("button", { name: "go" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That provider no longer exists");
    expect(alert.textContent).not.toContain("NotFound");
    const title = alert.querySelector("[data-domainkit-part='outcome-title']");
    const description = alert.querySelector("[data-domainkit-part='outcome-description']");
    expect(title?.textContent).toBe("That provider no longer exists");
    expect(description?.textContent).toBe("Reload the page and start this step again.");
  });

  it("keeps the snapshot, the discovery, and the provider list when a command fails", async () => {
    const { domain, transport } = scenario();
    let controller: Connect.Controller | null = null;
    function Probe() {
      controller = Connect.useController({ domain });
      return null;
    }
    const current = (): Connect.Controller => {
      if (controller === null) throw new Error("The probe rendered no controller");
      return controller;
    };
    render(<Probe />, { wrapper: wrap(transport) });
    await waitFor(() => expect(current().state._tag).toBe("Disconnected"));
    const providers = current().providers.length;
    const discovered = current().discovery?._tag;
    expect(providers).toBeGreaterThan(0);
    expect(discovered).toBeDefined();

    act(() => {
      current().connect({ method: "token", provider: "absent", values: { token: "x" } });
    });
    await waitFor(() => expect(current().state._tag).toBe("Failure"));
    const state = current().state;
    if (state._tag !== "Failure") throw new Error("The connect did not fail");
    // The customer keeps the page they were on: the domain, what discovery found, and the form.
    expect(state.snapshot?.domain).toBe(domain);
    expect(state.discovery?._tag).toBe(discovered);
    expect(state.attempt).toEqual({ method: "token", provider: "absent" });
    expect(current().providers).toHaveLength(providers);
    expect(current().snapshot?.domain).toBe(domain);
  });

  it("preselects a connection discovery already found for the zone", async () => {
    const { domain, sibling, transport, zone } = scenario();
    await connectDomain(transport, domain);
    render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={sibling} />
      </DomainKit.Root>,
    );
    await click("Connect");
    await screen.findByText(`${zone} already serves this domain`);
    await user.click(screen.getByRole("button", { name: `Use ${zone}` }));
    await waitFor(() => expect(screen.getByText("fake connected")).toBeDefined());
    expect(transport.calls.some((call) => call.method === "connection.discover")).toBe(true);
  });
});

describe("Provision.useController", () => {
  it("plans, approves, and applies, handing the receipt to the host", async () => {
    const { domain, requirements, transport } = scenario();
    await connectDomain(transport, domain);
    const applied: Array<string> = [];
    render(
      <DomainKit.Root transport={transport}>
        <Provision.Flow
          domain={domain}
          onApplied={(receipt) => applied.push(receipt.status)}
          requirements={requirements}
        />
      </DomainKit.Root>,
    );
    await click("Review changes");
    await click("Approve");
    await waitFor(() => expect(applied).toEqual(["complete"]));
    expect(transport.calls.map((call) => call.method)).toContain("provisioning.approve");
    expect(transport.calls.map((call) => call.method)).toContain("provisioning.apply");
  });

  it("declines a plan and reports the attempt as declined", async () => {
    const { domain, requirements, transport } = scenario();
    await connectDomain(transport, domain);
    render(
      <DomainKit.Root transport={transport}>
        <Provision.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await click("Review changes");
    await click("Decline");
    await waitFor(() => expect(screen.getByText(/Declined by/)).toBeDefined());
    expect(transport.calls.map((call) => call.method)).toContain("provisioning.reject");
  });
});

describe("Verify.useController", () => {
  it("observes on mount and reports readiness per requirement", async () => {
    const { domain, transport } = scenario();
    await connectDomain(transport, domain);
    function Panel() {
      const controller = Verify.useController({ domain, polling: false });
      return <Verify.Status controller={controller} />;
    }
    render(<Panel />, { wrapper: wrap(transport) });
    await waitFor(() =>
      expect(transport.calls.some((call) => call.method === "verification.observe")).toBe(true),
    );
  });
});

describe("Cleanup.useController", () => {
  it("fails with a rendered reason when the domain has no receipt to undo", async () => {
    const { domain, transport } = scenario();
    await connectDomain(transport, domain);
    function Panel() {
      const controller = Cleanup.useController({ domain });
      return (
        <>
          <button onClick={controller.plan} type="button">
            plan
          </button>
          <Cleanup.Outcome controller={controller} />
        </>
      );
    }
    render(<Panel />, { wrapper: wrap(transport) });
    await user.click(screen.getByRole("button", { name: "plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That receipt no longer exists");
  });
});

describe("controller inputs", () => {
  it("abandons the plan when the domain changes, and keeps it when only the array identity does", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await connectDomain(transport, domain);
    function Harness({ target }: { readonly target: string }) {
      return (
        <DomainKit.Root transport={transport}>
          <Provision.Flow domain={target} requirements={[...requirements]} />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness target={domain} />);
    await click("Review changes");
    await screen.findByRole("button", { name: "Approve" });

    // A fresh `requirements` array with the same records is the same attempt.
    view.rerender(<Harness target={domain} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();

    // A different domain is a different attempt, so the old plan can no longer be approved.
    view.rerender(<Harness target={sibling} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve" })).toBeNull());
  });

  it("drops readiness when the domain changes", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await applyDomain(transport, domain, requirements);
    function Probe({ target }: { readonly target: string }) {
      const controller = Verify.useController({ domain: target, polling: false });
      return <output>{controller.readiness?.attachmentId ?? "none"}</output>;
    }
    function Harness({ target }: { readonly target: string }) {
      return (
        <DomainKit.Root transport={transport}>
          <Probe target={target} />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness target={domain} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe("none"));
    view.rerender(<Harness target={sibling} />);
    expect(screen.getByRole("status").textContent).toBe("none");
  });
});

describe("controller identity", () => {
  it("shows no connection from the previous domain in the first frame after a change", async () => {
    const { domain, sibling, transport } = scenario();
    await connectDomain(transport, domain);
    function Probe({ target }: { readonly target: string }) {
      const controller = Connect.useController({ domain: target });
      return <output>{controller.snapshot?.domain ?? "none"}</output>;
    }
    function Harness({ target }: { readonly target: string }) {
      return (
        <DomainKit.Root transport={transport}>
          <Probe target={target} />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness target={domain} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(domain));
    view.rerender(<Harness target={sibling} />);
    expect(screen.getByRole("status").textContent).toBe("none");
  });
});

describe("interactive return destination", () => {
  const startMethod = (transport: {
    readonly calls: ReadonlyArray<{ method: string; input: unknown }>;
  }) =>
    (
      transport.calls.find((call) => call.method === "connection.start")?.input as
        | { readonly method: { readonly _tag: string; readonly returnTo?: string } }
        | undefined
    )?.method;

  const oauth = () => {
    const zone = `oauth${(cases += 1)}.example`;
    return {
      domain: `app.${zone}`,
      transport: Testing.transport({ provider: { oauth: true, zones: [zone] } }),
    };
  };

  it("sends the page the customer started from", async () => {
    const { domain, transport } = oauth();
    render(
      <DomainKit.Root navigate={() => {}} transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    await click("Sign in (fake)");
    await waitFor(() => expect(startMethod(transport)).toBeDefined());
    expect(startMethod(transport)).toMatchObject({
      _tag: "OAuth",
      returnTo: window.location.href,
    });
  });

  it("takes an explicit destination from the host", async () => {
    const { domain, transport } = oauth();
    render(
      <DomainKit.Root navigate={() => {}} transport={transport}>
        <Connect.Flow domain={domain} returnTo="https://app.example.com/domains/1" />
      </DomainKit.Root>,
    );
    await click("Connect");
    await click("Sign in (fake)");
    await waitFor(() => expect(startMethod(transport)).toBeDefined());
    expect(startMethod(transport)).toMatchObject({
      _tag: "OAuth",
      returnTo: "https://app.example.com/domains/1",
    });
  });

  it("sends none when the host opts out, leaving the server's default in charge", async () => {
    const { domain, transport } = oauth();
    render(
      <DomainKit.Root navigate={() => {}} transport={transport}>
        <Connect.Flow domain={domain} returnTo={null} />
      </DomainKit.Root>,
    );
    await click("Connect");
    await click("Sign in (fake)");
    await waitFor(() => expect(startMethod(transport)).toBeDefined());
    expect(startMethod(transport)).toEqual({ _tag: "OAuth" });
  });
});
