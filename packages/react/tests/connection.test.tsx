import { act, render } from "@testing-library/react";
import { DomainKit as Kit, Reason } from "domainkit";
import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";

import { Connect, DomainKit, Testing } from "../src/index.ts";
import { attach, mount, run, scenario, until } from "./harness.tsx";

describe("DomainKit.Root", () => {
  it("keeps transport identity across renders, so an inline value does not restart controllers", async () => {
    const { domain, transport: base } = scenario();
    const { calls, ...groups } = base;
    const view = mount({ ...groups }, () => Connect.useController({ domain }));
    await until(() => expect(view.result.current.state._tag).toBe("Disconnected"));
    // A new object every render: exactly what writing the transport inline in JSX produces.
    view.rerender();
    view.rerender();
    expect(calls.filter((call) => call.method === "connection.inspect")).toHaveLength(1);
  });

  it("exposes the transport and the capabilities the host declared", () => {
    const { transport } = scenario({ capabilities: ["connection", "verification"] });
    const view = mount(transport, () => DomainKit.useCapabilities());
    expect([...view.result.current].sort()).toEqual(["connection", "verification"]);
  });

  it("carries the host's read-only flag to every hook under it", () => {
    const { transport } = scenario();
    const view = mount(transport, () => DomainKit.useReadOnly(), { readOnly: true });
    expect(view.result.current).toBe(true);
  });
});

describe("Connect.useController", () => {
  it("connects with the values the provider's token method declares", async () => {
    const { domain, transport } = scenario();
    const view = mount(transport, () => Connect.useController({ domain }));
    await until(() => expect(view.result.current.state._tag).toBe("Disconnected"));
    const [method] = view.result.current.providers[0]?.methods ?? [];
    expect(method?.fields?.map((field) => field.name)).toEqual(["token"]);

    await run(() =>
      view.result.current.connect({ method: "token", provider: "fake", values: { token: "tok" } }),
    );
    await until(() => expect(Connect.holdsConnection(view.result.current)).toBe(true));
    expect(transport.calls.find((call) => call.method === "connection.start")?.input).toMatchObject(
      { method: { _tag: "Token", values: { token: "tok" } }, provider: "fake" },
    );
  });

  it("keeps the snapshot, the discovery, and the provider list when a command fails", async () => {
    const { domain, transport } = scenario();
    const view = mount(transport, () => Connect.useController({ domain }));
    await until(() => expect(view.result.current.state._tag).toBe("Disconnected"));
    const providers = view.result.current.providers.length;
    const discovered = view.result.current.discovery?._tag;
    expect(providers).toBeGreaterThan(0);
    expect(discovered).toBeDefined();

    await run(() =>
      view.result.current.connect({ method: "token", provider: "absent", values: { token: "x" } }),
    );
    await until(() => expect(view.result.current.state._tag).toBe("Failure"));
    const state = view.result.current.state;
    if (state._tag !== "Failure") throw new Error("The connect did not fail");
    // The customer keeps the page they were on: the domain, what discovery found, and the form.
    expect(state.snapshot?.domain).toBe(domain);
    expect(state.discovery?._tag).toBe(discovered);
    expect(state.attempt).toEqual({ method: "token", provider: "absent" });
    expect(view.result.current.providers).toHaveLength(providers);
    // The failure is answered beside the method it was raised on rather than twice.
    expect(Connect.answeredInPlace(view.result.current)).toBe(true);
    expect(Connect.attempted(view.result.current, "absent", "token")).toBe(state.error);
    expect(Connect.attempted(view.result.current, "fake", "token")).toBeNull();
  });

  it("offers nothing when the domain could not be inspected", async () => {
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
    const view = mount(unreachable, () => Connect.useController({ domain }));
    await until(() => expect(view.result.current.state._tag).toBe("Failure"));
    // Nothing was read, so there is nothing to offer.
    expect(Connect.offering(view.result.current)).toBe(false);
    expect(Connect.hostProvider(view.result.current)).toBeNull();
  });

  it("names the provider whose nameservers serve the zone", async () => {
    const { domain, transport } = scenario();
    const view = mount(transport, () => Connect.useController({ domain }));
    await until(() => expect(Connect.hostProvider(view.result.current)?.id).toBe("fake"));
    expect(Connect.offering(view.result.current)).toBe(true);
    expect(Connect.offering(view.result.current, "never")).toBe(false);
    expect(Connect.displayName(view.result.current, "fake")).toBe("Fake fake");
    expect(Connect.displayName(view.result.current, "absent")).toBe("absent");
  });

  it("attaches the domain to the one connection that already serves its zone", async () => {
    const { domain, sibling, transport, zone } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () => Connect.useController({ domain: sibling }));
    // The account the customer already granted covers this domain too, so nothing is asked twice.
    await until(() => expect(Connect.holdsConnection(view.result.current)).toBe(true));
    expect(view.result.current.snapshot?.attachment?.label).toBe(zone);
    expect(transport.calls.filter((call) => call.method === "connection.attach")).toHaveLength(1);
  });

  it("offers both connections when two of this owner's serve the zone", async () => {
    const { domain, sibling, transport, zone } = scenario();
    await attach(transport, domain);
    // A second account on the same provider, connected without a domain of its own.
    await attach(transport);
    const view = mount(transport, () => Connect.useController({ domain: sibling }));
    await until(() =>
      expect(Connect.reusableConnections(view.result.current).length).toBeGreaterThan(1),
    );
    // Which account the records go to is a real decision, so nothing is attached for the customer.
    expect(Connect.reusableConnections(view.result.current)[0]?.zone).toBe(zone);
    expect(transport.calls.some((call) => call.method === "connection.attach")).toBe(false);
    expect(Connect.offering(view.result.current)).toBe(true);
  });

  it("re-credits the connection it holds rather than starting a second account", async () => {
    const { domain, transport } = scenario();
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    await attach(transport, domain);
    const snapshot = await Effect.runPromise(connection.inspect(domain));
    // The provider turned the credential down, which is what a customer reconnects from.
    const stale: Transport.Interface = {
      ...transport,
      connection: {
        ...connection,
        inspect: (target) =>
          Effect.map(connection.inspect(target), (read) => ({
            ...read,
            status: "reconnect" as const,
          })),
      },
    };
    const view = mount(stale, () => Connect.useController({ domain }));
    await until(() => expect(Connect.reconnect(view.result.current)).toBe(true));
    await run(() =>
      view.result.current.connect({
        method: "token",
        provider: "fake",
        values: { token: "again" },
      }),
    );
    await until(() =>
      expect(transport.calls.some((call) => call.method === "connection.reconnect")).toBe(true),
    );
    expect(
      transport.calls.find((entry) => entry.method === "connection.reconnect")?.input,
    ).toMatchObject({
      connectionId: snapshot.connectionId,
      method: { _tag: "Token", values: { token: "again" } },
    });
    // Starting instead would mint a second account and then fail, because the domain is attached.
    expect(transport.calls.filter((entry) => entry.method === "connection.start")).toHaveLength(1);
  });

  it("names the account the records go to and reads the receipt once", async () => {
    const { domain, transport, zone } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () => Connect.useController({ domain }));
    await until(() => expect(Connect.holdsConnection(view.result.current)).toBe(true));
    expect(view.result.current.snapshot?.attachment?.label).toBe(zone);
    // Nothing has been applied here yet, so there is no receipt to name records from.
    expect(view.result.current.receipt).toBeNull();
    expect(transport.calls.filter((call) => call.method === "provisioning.receipt")).toHaveLength(
      0,
    );
  });

  it("shows no connection from the previous domain in the first frame after a change", async () => {
    const { domain, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) => Connect.useController({ domain: target }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.snapshot?.domain).toBe(domain));
    act(() => view.rerender({ target: sibling }));
    expect(view.result.current.snapshot).toBeNull();
  });

  it("re-inspects the domain when the host bumps the revision", async () => {
    const { domain, transport } = scenario();
    const inspects = () =>
      transport.calls.filter((call) => call.method === "connection.inspect").length;
    function Probe() {
      Connect.useController({ domain });
      return null;
    }
    function Harness({ revision }: { readonly revision: number }) {
      return (
        <DomainKit.Root revision={revision} transport={transport}>
          <Probe />
        </DomainKit.Root>
      );
    }
    const view = render(<Harness revision={0} />);
    await until(() => expect(inspects()).toBe(1));
    view.rerender(<Harness revision={0} />);
    expect(inspects()).toBe(1);
    view.rerender(<Harness revision={1} />);
    await until(() => expect(inspects()).toBe(2));
  });
});

describe("Connect.describeMethods", () => {
  it("splits a provider's methods into the ones clicked through and the ones typed", async () => {
    const zone = "methods.example";
    const transport = Testing.transport({
      provider: { nameserverSuffixes: [zone], oauth: true, zones: [zone] },
    });
    const view = mount(transport, () => Connect.useController({ domain: `app.${zone}` }));
    await until(() => expect(view.result.current.providers).toHaveLength(1));
    const provider = view.result.current.providers[0];
    if (provider === undefined) throw new Error("The snapshot described no provider");
    const methods = Connect.describeMethods(provider);
    expect(methods.interactive.map((method) => method.kind)).toEqual(["oauth"]);
    expect(methods.typed.map((method) => method.kind)).toEqual(["token"]);
    // Both are on offer, so a surface shows one and a control that opens the other in its place.
    expect(methods.alternate).toBe(true);
    const fields = methods.typed[0]?.fields;
    expect(fields?.required.map((field) => field.name)).toEqual(["token"]);
    // The documentation link explains the secret, so it rides that field rather than the form.
    expect(fields?.explains).toBe("token");
  });

  it("names the one field a rejection was about, and none for a rejected request", () => {
    const fields = [
      { name: "account", required: false, secret: false },
      { name: "token", required: true, secret: true },
    ];
    const unauthenticated = new Kit.Error({
      reason: new Reason.Unauthenticated({ message: "bad token" }),
    });
    expect(Connect.rejectedField(unauthenticated, fields)).toBe("token");
    const invalid = new Kit.Error({
      reason: new Reason.InvalidInput({ field: "account", message: "unknown account" }),
    });
    expect(Connect.rejectedField(invalid, fields)).toBe("account");
    const busy = new Kit.Error({ reason: new Reason.Busy({ key: "connect:fake" }) });
    expect(Connect.rejectedField(busy, fields)).toBeNull();
    expect(Connect.rejectedField(null, fields)).toBeNull();
  });
});

describe("interactive return destination", () => {
  const startMethod = (transport: Testing.RecordingTransport) =>
    (
      transport.calls.find((call) => call.method === "connection.start")?.input as
        | { readonly method: { readonly _tag: string; readonly returnTo?: string } }
        | undefined
    )?.method;

  let oauthCases = 0;
  const oauth = () => {
    const zone = `oauth${(oauthCases += 1)}.example`;
    return {
      domain: `app.${zone}`,
      transport: Testing.transport({
        provider: { nameserverSuffixes: [zone], oauth: true, zones: [zone] },
      }),
    };
  };

  const start = async (returnTo: string | null | undefined) => {
    const { domain, transport } = oauth();
    const view = mount(
      transport,
      () => Connect.useController({ domain, ...(returnTo === undefined ? {} : { returnTo }) }),
      { navigate: () => {} },
    );
    await until(() => expect(view.result.current.providers).toHaveLength(1));
    await run(() => view.result.current.connect({ method: "oauth", provider: "fake" }));
    await until(() => expect(startMethod(transport)).toBeDefined());
    return startMethod(transport);
  };

  it("sends the page the customer started from", async () => {
    expect(await start(undefined)).toMatchObject({
      _tag: "OAuth",
      returnTo: window.location.href,
    });
  });

  it("takes an explicit destination from the host", async () => {
    expect(await start("https://app.example.com/domains/1")).toMatchObject({
      _tag: "OAuth",
      returnTo: "https://app.example.com/domains/1",
    });
  });

  it("sends none when the host opts out, leaving the server's default in charge", async () => {
    expect(await start(null)).toEqual({ _tag: "OAuth" });
  });
});
