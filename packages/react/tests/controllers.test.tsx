import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DnsRecord, DomainKit as Kit, Reason } from "domainkit";
import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";
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
      // The zone's nameservers are the fake's own, so discovery names it as the host.
      provider: { nameserverSuffixes: [zone], zones: [zone] },
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

/** The connected card, which is what a domain that holds a connection renders. */
const connectedCard = () => document.querySelector("[data-domainkit-part='connected-card']");

const untilConnected = () => waitFor(() => expect(connectedCard()).not.toBeNull());

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
  await user.click(screen.getByRole("button", { name: "Connect with an API token" }));
  await untilConnected();
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
  await click(/^Add \d+ records?$/);
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
    await user.click(screen.getByRole("button", { name: "Connect with an API token" }));
    await untilConnected();
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

  it("offers no connect surface when the domain could not be inspected", async () => {
    const { domain, transport } = scenario();
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    const unreachable: Transport.Interface = {
      ...transport,
      connection: {
        ...connection,
        inspect: () =>
          Effect.fail(
            new Kit.Error({
              reason: new Reason.ProviderUnavailable({ message: "down", provider: "fake" }),
            }),
          ),
      },
    };
    render(
      <DomainKit.Root transport={unreachable}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    // Nothing was read, so there is nothing to offer: the failure reads, the trigger does not.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("isn't responding");
    expect(screen.queryByRole("button", { name: /^Connect/ })).toBeNull();
  });

  it("attaches a second domain to the connection that already serves its zone", async () => {
    const { domain, sibling, transport, zone } = scenario();
    await connectDomain(transport, domain);
    const before = transport.calls.length;
    render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={sibling} />
      </DomainKit.Root>,
    );
    await untilConnected();
    const attaches = transport.calls
      .slice(before)
      .filter((call) => call.method === "connection.attach");
    expect(attaches).toHaveLength(1);
    expect(attaches[0]?.input).toMatchObject({ domain: sibling, zone });
    // The account was granted once; a second domain on it is not another decision to take.
    expect(screen.queryByRole("button", { name: /^Connect/ })).toBeNull();
  });

  it("leaves a read-only surface disconnected rather than attaching for the customer", async () => {
    const { domain, sibling, transport } = scenario();
    await connectDomain(transport, domain);
    const before = transport.calls.length;
    render(
      <DomainKit.Root readOnly transport={transport}>
        <Connect.Flow domain={sibling} />
      </DomainKit.Root>,
    );
    await waitFor(() =>
      expect(
        transport.calls.slice(before).some((call) => call.method === "connection.discover"),
      ).toBe(true),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(transport.calls.slice(before).some((call) => call.method === "connection.attach")).toBe(
      false,
    );
    expect(connectedCard()).toBeNull();
  });

  it("keeps the prompt when two of this owner's connections both serve the zone", async () => {
    const { domain, sibling, transport } = scenario();
    await connectDomain(transport, domain);
    // A second account on the same provider, connected without a domain of its own.
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    await Effect.runPromise(
      connection.start({ method: Transport.Method.token("tok"), provider: "fake" }),
    );
    const before = transport.calls.length;
    render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={sibling} />
      </DomainKit.Root>,
    );
    // Two connections reach the zone, so which account the records go to is a real decision.
    await screen.findByRole("button", { name: /^Connect/ });
    expect(transport.calls.slice(before).some((call) => call.method === "connection.attach")).toBe(
      false,
    );
    expect(connectedCard()).toBeNull();
  });

  it("names the account on the card, and how many records this domain holds", async () => {
    const { domain, requirements, transport, zone } = scenario();
    await connectDomain(transport, domain);
    const first = render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await untilConnected();
    const label = () => connectedCard()?.querySelector("[data-domainkit-part='connected-label']");
    await waitFor(() => expect(label()?.textContent).toBe(`Fake fake · ${zone}`));
    // Nothing has been applied here yet, so the card claims no records.
    expect(connectedCard()?.querySelector("[data-domainkit-part='connected-applied']")).toBeNull();
    first.unmount();

    const applying = render(
      <DomainKit.Root transport={transport}>
        <Provision.Flow domain={domain} requirements={requirements} />
      </DomainKit.Root>,
    );
    await click("Review changes");
    await click(/^Add \d+ records?$/);
    await screen.findByText("DNS records added.");
    applying.unmount();

    render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await untilConnected();
    const applied = () =>
      connectedCard()?.querySelector("[data-domainkit-part='connected-applied']");
    await waitFor(() => expect(applied()?.textContent).toBe("1 added"));
  });
});

describe("Connect.Dialog", () => {
  /** A zone the fake serves and offers OAuth for, so the dialog has two methods to order. */
  const both = () => {
    const zone = `dialog${(cases += 1)}.example`;
    return {
      domain: `app.${zone}`,
      transport: Testing.transport({
        provider: { nameserverSuffixes: [zone], oauth: true, zones: [zone] },
      }),
    };
  };

  const dialog = () => screen.getByRole("dialog");

  it("names the narrowed provider with the mark the prompt uses", async () => {
    const { domain, transport } = both();
    render(
      <DomainKit.Root navigate={() => {}} transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    const media = dialog().querySelector("[data-domainkit-part='dialog-media']");
    expect(media?.querySelector("[data-domainkit-part='provider-mark']")?.textContent).toBe("F");
  });

  it("offers the interactive method first and opens the token form in its place", async () => {
    const { domain, transport } = both();
    render(
      <DomainKit.Root navigate={() => {}} transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    const section = () => dialog().querySelector("[data-domainkit-part='provider-authentication']");
    const oauth = section()?.querySelector("[data-domainkit-part='oauth-connect']");
    const alternate = section()?.querySelector("[data-domainkit-part='method-alternate']");
    expect(oauth).not.toBeNull();
    // The click-through method is the offer; the token is the plain alternative under it.
    expect(oauth?.compareDocumentPosition(alternate as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(dialog().querySelector("[data-domainkit-part='token-connect']")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Use an API token instead" }));
    expect(screen.getByLabelText(/Token/)).toBeDefined();
    // The offer it replaced is gone, and the way back is a link rather than a disclosure.
    expect(dialog().querySelector("[data-domainkit-part='oauth-connect']")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(dialog().querySelector("[data-domainkit-part='oauth-connect']")).not.toBeNull();
    expect(dialog().querySelector("[data-domainkit-part='token-connect']")).toBeNull();
  });

  // The header's provider menu is a floating surface: opening it is a browser concern, and
  // `tests/browser/flow.spec.ts` covers picking a provider and the dialog re-narrowing to it.

  it("renders the form directly for a provider that offers a token and nothing else", async () => {
    const { domain, transport } = scenario();
    render(
      <DomainKit.Root transport={transport}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    expect(dialog().querySelector("[data-domainkit-part='token-alternative']")).toBeNull();
    expect(screen.getByLabelText(/Token/)).toBeDefined();
  });

  it("stays narrowed to the provider it named while the command is in flight", async () => {
    const { domain, transport } = both();
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    const pending: Transport.Interface = {
      ...transport,
      connection: { ...connection, start: () => Effect.never },
    };
    render(
      <DomainKit.Root navigate={() => {}} transport={pending}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    expect(dialog().querySelector("[data-domainkit-part='dialog-media']")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue with Fake fake" }));
    await screen.findByText("Connecting…");
    // The discovery that narrowed the dialog outlives the command, so the surface does not
    // widen to the whole provider list and back again while the customer waits.
    expect(dialog().querySelector("[data-domainkit-part='dialog-media']")).not.toBeNull();
  });

  it("never carries a token to another domain", async () => {
    const { domain, sibling, transport } = scenario();
    // The form itself, kept mounted across the change: the dialog would close and take the field
    // with it, but a host composing `Connect.Form` keeps it on screen.
    function Harness({ target }: { readonly target: string }) {
      const controller = Connect.useController({ domain: target });
      return (
        <DomainKit.Root transport={transport}>
          <Connect.Form controller={controller} />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness target={domain} />, { wrapper: wrap(transport) });
    await user.type(await screen.findByLabelText(/Token/), "one-domains-token");
    view.rerender(<Harness target={sibling} />);
    const field = await screen.findByLabelText(/Token/);
    expect((field as HTMLInputElement).value).toBe("");
  });

  it("asks for the fields a provider does not need with a control that reads as one", async () => {
    const { domain, transport } = scenario();
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    // The fake declares one field; the optional one rides the descriptor, which is where the wire
    // carries it.
    const withOptional: Transport.Interface = {
      ...transport,
      connection: {
        ...connection,
        inspect: (target) =>
          Effect.map(connection.inspect(target), (snapshot) => ({
            ...snapshot,
            providers: snapshot.providers.map((provider) => ({
              ...provider,
              methods: provider.methods.map((method) =>
                method.fields === null
                  ? method
                  : {
                      ...method,
                      fields: [
                        ...method.fields,
                        { name: "accountId", required: false, secret: false },
                      ],
                    },
              ),
            })),
          })),
      },
    };
    render(
      <DomainKit.Root transport={withOptional}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    const more = dialog().querySelector("[data-domainkit-part='more-options']");
    expect(more?.getAttribute("data-state")).toBe("closed");
    // A button, not a line of body text: it announces what it does and whether it is open.
    const trigger = screen.getByRole("button", { name: "Add an account id" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/Account id/)).toBeNull();

    await user.click(trigger);
    expect(more?.getAttribute("data-state")).toBe("open");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText(/Account id/)).toBeDefined();
    expect(more?.querySelector("[data-domainkit-part='more-options-panel']")).not.toBeNull();
  });

  it("keeps the typed token after a rejection, so trying again needs no retyping", async () => {
    const { domain, transport } = scenario();
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    const attempts: Array<unknown> = [];
    // A provider that turns down every token, the way Cloudflare answers one it does not accept.
    const refusing: Transport.Interface = {
      ...transport,
      connection: {
        ...connection,
        start: (input) => {
          if (input.method._tag !== "Token") return connection.start(input);
          attempts.push(input.method);
          return Effect.fail(
            new Kit.Error({ reason: new Reason.Unauthenticated({ message: "refused" }) }),
          );
        },
      },
    };
    render(
      <DomainKit.Root transport={refusing}>
        <Connect.Flow domain={domain} />
      </DomainKit.Root>,
    );
    await click("Connect");
    await user.type(await screen.findByLabelText(/Token/), "cf_bad_token");
    await user.click(screen.getByRole("button", { name: "Connect with an API token" }));
    await screen.findByText("Token not accepted");
    expect((screen.getByLabelText(/Token/) as HTMLInputElement).value).toBe("cf_bad_token");
    await user.click(screen.getByRole("button", { name: "Connect with an API token" }));
    await waitFor(() => expect(attempts).toHaveLength(2));
    expect(attempts[1]).toMatchObject({ _tag: "Token", values: { token: "cf_bad_token" } });
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
    await click(/^Add \d+ records?$/);
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
    await screen.findByRole("button", { name: /^Add \d+ records?$/ });

    // A fresh `requirements` array with the same records is the same attempt.
    view.rerender(<Harness target={domain} />);
    expect(screen.getByRole("button", { name: /^Add \d+ records?$/ })).toBeDefined();

    // A different domain is a different attempt, so the old plan can no longer be approved.
    view.rerender(<Harness target={sibling} />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Add \d+ records?$/ })).toBeNull(),
    );
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
      transport: Testing.transport({
        provider: { nameserverSuffixes: [zone], oauth: true, zones: [zone] },
      }),
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
    await click("Continue with Fake fake");
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
    await click("Continue with Fake fake");
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
    await click("Continue with Fake fake");
    await waitFor(() => expect(startMethod(transport)).toBeDefined());
    expect(startMethod(transport)).toEqual({ _tag: "OAuth" });
  });
});
