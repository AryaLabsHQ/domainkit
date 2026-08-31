import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { DomainName, Transport } from "domainkit";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { renderToString } from "react-dom/server";

import { Connection, DomainKit, Lifecycle, Testing } from "../src/index.ts";

afterEach(cleanup);

const disconnected = (reusable = false) => ({
  _tag: "Disconnected" as const,
  domain: "mail.example.com",
  provider: Testing.provider(),
  reusableConnections: reusable
    ? [
        {
          connection: Testing.connection(),
          targets: [
            Testing.target({
              evidence: {
                accountName: "existing account",
                nameservers: [],
                status: "active",
                zoneType: "full",
              },
            }),
          ],
        },
      ]
    : [],
});

describe("Connection.Flow", () => {
  it("exposes the same Atom model to custom host UI", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected() });
    const CustomConnection = () => {
      const model = Connection.useModel("mail.example.com");
      const state = useAtomValue(model.state);
      const command = useAtomSet(model.command);
      return state._tag === "Disconnected" ? (
        <button
          onClick={() => command(Connection.Command.Connect({ method: Transport.Method.OAuth() }))}
        >
          Custom connect
        </button>
      ) : (
        <span>{state._tag}</span>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <CustomConnection />
      </DomainKit.Root>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Custom connect" }));
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(transport.calls.connect).toHaveLength(1);
  });

  it("runs a canonical Effect transport layer", async () => {
    const service = Transport.Service.of({
      cleanup: {
        apply: () => Effect.die("not used"),
        plan: () => Effect.die("not used"),
      },
      connection: {
        attach: () => Effect.die("not used"),
        connect: () => Effect.die("not used"),
        inspect: ({ domain }) => Effect.succeed({ _tag: "Unsupported", domain }),
        detach: () => Effect.die("not used"),
      },
      provisioning: {
        apply: () => Effect.die("not used"),
        plan: () => Effect.die("not used"),
      },
      verification: { observe: () => Effect.die("not used") },
    });
    render(
      <DomainKit.Root transport={Layer.succeed(Transport.Service, service)}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    expect(
      await screen.findByText("Automatic connection is not available for this domain"),
    ).toBeTruthy();
  });

  it("starts OAuth and delegates navigation to the host", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      connect: {
        _tag: "Redirect",
        authorizationUrl: "https://dash.cloudflare.com/oauth2/auth",
      },
      inspect: disconnected(),
    });
    const navigations: Array<string> = [];
    render(
      <DomainKit.Root navigate={(url) => navigations.push(url)} transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Continue with OAuth" }));

    await waitFor(() => expect(navigations).toEqual(["https://dash.cloudflare.com/oauth2/auth"]));
    expect(transport.calls.connect).toEqual([
      {
        domain: "mail.example.com",
        method: Transport.Method.OAuth(),
        providerId: "cloudflare",
      },
    ]);
  });

  it("keeps provider integration distinct from OAuth", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      inspect: {
        ...disconnected(),
        provider: Testing.provider({
          id: "vercel",
          name: "Vercel",
          authentication: [{ _tag: "Integration", label: "Install Vercel Integration" }],
        }),
      },
      connect: {
        _tag: "Redirect",
        authorizationUrl: "https://vercel.com/integrations/domainkit",
      },
    });
    const navigations: Array<string> = [];
    render(
      <DomainKit.Root navigate={(url) => navigations.push(url)} transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect" }));
    expect(screen.getByRole("button", { name: "Install Vercel Integration" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with OAuth" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Install Vercel Integration" }));

    await waitFor(() => expect(navigations).toEqual(["https://vercel.com/integrations/domainkit"]));
    expect(transport.calls.connect[0]?.method).toEqual(Transport.Method.Integration());
  });

  it("makes token authentication an explicit alternative", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: disconnected() });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("API token"), "secret-token");
    await user.click(screen.getByRole("button", { name: "Connect with token" }));

    expect(await screen.findByText("Cloudflare connected")).toBeTruthy();
    expect(transport.calls.connect).toEqual([
      {
        domain: "mail.example.com",
        method: Transport.Method.Token({ token: "secret-token" }),
        providerId: "cloudflare",
      },
    ]);
  });

  it("collects provider-declared token parameters", async () => {
    const user = userEvent.setup();
    const snapshot = disconnected();
    const transport = Testing.makeFakeTransport({
      inspect: {
        ...snapshot,
        provider: Testing.provider({
          authentication: [
            {
              _tag: "Token",
              label: "Connect with token",
              parameters: [
                {
                  key: "accountId",
                  label: "Team ID",
                  required: true,
                },
              ],
            },
          ],
        }),
      },
    });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Team ID"), "team_arya");
    await user.type(screen.getByLabelText("API token"), "secret-token");
    await user.click(screen.getByRole("button", { name: "Connect with token" }));

    expect(transport.calls.connect[0]?.method).toEqual(
      Transport.Method.Token({ token: "secret-token", parameters: { accountId: "team_arya" } }),
    );
  });

  it("attaches an explicit reusable provider target without another OAuth round trip", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: disconnected(true) });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: /Use existing account/ }));

    expect(await screen.findByText("Cloudflare connected")).toBeTruthy();
    expect(transport.calls.attach).toHaveLength(1);
    expect(transport.calls.attach[0]).toMatchObject({
      connectionId: "connection-1",
      domain: "mail.example.com",
      target: { accountId: "account-1", zoneId: "zone-1" },
    });
    expect(transport.calls.connect).toEqual([]);
  });

  it("restores all discovered targets after detaching an attached target", async () => {
    const user = userEvent.setup();
    const initial = disconnected(true);
    const reusableConnection = initial.reusableConnections[0];
    if (reusableConnection === undefined) throw new Error("Reusable fixture is missing");
    const firstTarget = reusableConnection.targets[0];
    if (firstTarget === undefined) throw new Error("Reusable target fixture is missing");
    const secondTarget = Testing.target({
      accountId: "team-2",
      accountKind: "team",
      evidence: {
        accountName: "Samva Team",
        nameservers: [],
        status: "active",
        zoneType: "full",
      },
      zoneId: "zone-2",
    });
    const snapshot = {
      ...initial,
      reusableConnections: [{ ...reusableConnection, targets: [firstTarget, secondTarget] }],
    };
    const reusableWithTargets = snapshot.reusableConnections[0];
    if (reusableWithTargets === undefined) throw new Error("Reusable fixture is missing");
    const connection = Testing.connected({
      attachment: Testing.attachment({ target: firstTarget }),
    });
    const transport = Testing.makeFakeTransport({
      inspect: [snapshot, snapshot],
      detach: {
        _tag: "Detached",
        attachment: connection.attachment,
        connection: connection.connection,
        remainingAttachments: 0,
      },
    });
    const Harness = () => {
      const controller = Connection.useController("mail.example.com");
      const state = controller.state;
      return (
        <>
          <span>{state._tag}</span>
          {state._tag === "Disconnected" ? (
            <>
              <button onClick={() => controller.attach(reusableWithTargets, firstTarget)}>
                Attach target
              </button>
              {state.reusableConnections.flatMap(({ targets }) =>
                targets.map((target) => <span key={target.zoneId}>{target.zoneId}</span>),
              )}
            </>
          ) : state._tag === "Connected" ? (
            <button onClick={controller.detach}>Detach target</button>
          ) : null}
        </>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <Harness />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Attach target" }));
    await user.click(await screen.findByRole("button", { name: "Detach target" }));

    expect(await screen.findByText("Disconnected")).toBeTruthy();
    expect(screen.getAllByText("zone-1")).toHaveLength(1);
    expect(screen.getAllByText("zone-2")).toHaveLength(1);
    expect(transport.calls.attach[0]?.target).toBe(firstTarget);
  });

  it("re-inspects all targets after detaching an initially connected domain", async () => {
    const user = userEvent.setup();
    const firstTarget = Testing.target();
    const secondTarget = Testing.target({
      accountId: "team-2",
      accountKind: "team",
      evidence: {
        accountName: "Samva Team",
        nameservers: [],
        status: "active",
        zoneType: "full",
      },
      zoneId: "zone-2",
    });
    const connected = Testing.connected({
      attachment: Testing.attachment({ target: firstTarget }),
    });
    const detachedSnapshot = {
      _tag: "Disconnected" as const,
      domain: "mail.example.com",
      provider: connected.provider,
      reusableConnections: [
        {
          connection: connected.connection,
          targets: [firstTarget, secondTarget],
        },
      ],
    };
    const transport = Testing.makeFakeTransport({
      inspect: [connected, detachedSnapshot],
      detach: {
        _tag: "Detached",
        attachment: connected.attachment,
        connection: connected.connection,
        remainingAttachments: 0,
      },
    });
    const Harness = () => {
      const controller = Connection.useController("mail.example.com");
      return controller.state._tag === "Connected" ? (
        <button onClick={controller.detach}>Detach target</button>
      ) : controller.state._tag === "Disconnected" ? (
        <>
          {controller.state.reusableConnections.flatMap(({ targets }) =>
            targets.map((target) => <span key={target.zoneId}>{target.zoneId}</span>),
          )}
        </>
      ) : null;
    };
    render(
      <DomainKit.Root transport={transport}>
        <Harness />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Detach target" }));

    expect(await screen.findByText("zone-1")).toBeTruthy();
    expect(screen.getByText("zone-2")).toBeTruthy();
    expect(transport.calls.inspect).toHaveLength(2);
  });

  it("keeps a completed detach when target re-inspection fails", async () => {
    const user = userEvent.setup();
    const events: Array<Lifecycle.Event> = [];
    const connected = Testing.connected();
    const transport = Testing.makeFakeTransport({
      inspect: [
        connected,
        {
          _tag: "Failure",
          message: "Target discovery is temporarily unavailable",
          retry: "safe",
        },
      ],
      detach: {
        _tag: "Detached",
        attachment: connected.attachment,
        connection: connected.connection,
        remainingAttachments: 0,
      },
    });
    const Harness = () => {
      const controller = Connection.useController("mail.example.com");
      return (
        <>
          <span>{controller.state._tag}</span>
          {controller.state._tag === "Connected" ? (
            <button onClick={controller.detach}>Detach target</button>
          ) : controller.state._tag === "Disconnected" ? (
            <span>{controller.state.reusableConnections[0]?.targets[0]?.zoneId}</span>
          ) : null}
        </>
      );
    };
    render(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Harness />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Detach target" }));

    expect(await screen.findByText("Disconnected")).toBeTruthy();
    expect(screen.getByText("zone-1")).toBeTruthy();
    expect(events.map((event) => event._tag)).toEqual(["DomainDetached"]);
    expect(transport.calls.inspect).toHaveLength(2);
  });

  it("rejects a target whose identity differs from the discovered target", async () => {
    const user = userEvent.setup();
    const snapshot = disconnected(true);
    const reusableConnection = snapshot.reusableConnections[0];
    if (reusableConnection === undefined) throw new Error("Reusable fixture is missing");
    const discoveredTarget = reusableConnection.targets[0];
    if (discoveredTarget === undefined) throw new Error("Reusable target fixture is missing");
    const mismatchedTarget = {
      ...discoveredTarget,
      zoneName: DomainName.parse("other.example.com"),
    };
    const transport = Testing.makeFakeTransport({ inspect: snapshot });
    const Harness = () => {
      const controller = Connection.useController("mail.example.com");
      return (
        <button onClick={() => controller.attach(reusableConnection, mismatchedTarget)}>
          Attach mismatched target
        </button>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <Harness />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Attach mismatched target" }));
    expect(transport.calls.attach).toEqual([]);
  });

  it("shows unique, ambiguous, and unavailable target states", async () => {
    const unique = disconnected(true);
    const reusableConnection = unique.reusableConnections[0];
    if (reusableConnection === undefined) throw new Error("Reusable fixture is missing");
    const ambiguous = {
      ...unique,
      reusableConnections: [
        {
          ...reusableConnection,
          targets: [Testing.target(), Testing.target({ zoneId: "zone-2" })],
        },
      ],
    };
    const unavailable = {
      ...unique,
      reusableConnections: [{ ...reusableConnection, targets: [] }],
    };
    const assertTargetState = async (
      snapshot: typeof unique,
      state: "ambiguous" | "unavailable" | "unique",
    ) => {
      const transport = Testing.makeFakeTransport({ inspect: snapshot });
      const { unmount } = render(
        <DomainKit.Root transport={transport}>
          <Connection.Flow domain="mail.example.com" />
        </DomainKit.Root>,
      );
      try {
        await userEvent.click(await screen.findByRole("button", { name: "Connect" }));
        expect(screen.getByRole("dialog").querySelector(`[data-state="${state}"]`)).toBeTruthy();
      } finally {
        unmount();
      }
    };
    await assertTargetState(unique, "unique");
    await assertTargetState(ambiguous, "ambiguous");
    await assertTargetState(unavailable, "unavailable");
  });

  it("renders an existing connection without prompting", async () => {
    const transport = Testing.makeFakeTransport({
      inspect: {
        ...Testing.connected(),
      },
    });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    expect(await screen.findByText("Cloudflare connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("recovers a failed inspection through the public retry state", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      inspect: [
        { _tag: "Failure", message: "Connection status is unavailable", retry: "safe" },
        disconnected(),
      ],
    });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    expect(await screen.findByText("Connection status is unavailable")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Cloudflare manages DNS for this domain")).toBeTruthy();
    expect(transport.calls.inspect).toHaveLength(2);
  });

  it("rechecks after the user completes a required action", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      inspect: [
        {
          _tag: "Failure",
          message: "Update provider permissions before continuing",
          retry: "after-user-action",
        },
        disconnected(),
      ],
    });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    expect(await screen.findByText("Update provider permissions before continuing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Cloudflare manages DNS for this domain")).toBeTruthy();
    expect(transport.calls.inspect).toHaveLength(2);
  });

  it("ignores a pending connection after the domain changes", async () => {
    const pending = Promise.withResolvers<Connection.Connected>();
    const fake = Testing.makeFakeTransport({
      inspect: [disconnected(), { ...disconnected(), domain: "other.example.com" }],
    });
    const transport = Transport.layerFromAsync({
      ...fake,
      connection: {
        ...fake.connection,
        connect: async (input: Parameters<typeof fake.connection.connect>[0]) => {
          fake.calls.connect.push(input);
          return pending.promise;
        },
      },
    });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Continue with OAuth" }));

    rerender(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="other.example.com" />
      </DomainKit.Root>,
    );
    pending.resolve(Testing.connected());

    expect(await screen.findByText("Cloudflare manages DNS for this domain")).toBeTruthy();
    expect(fake.calls.inspect.at(-1)).toEqual({ domain: "other.example.com" });
  });

  it("imports and renders on the server without browser access", () => {
    const transport = Testing.makeFakeTransport({
      inspect: { _tag: "Unsupported", domain: "mail.example.com" },
    });
    expect(
      renderToString(
        <DomainKit.Root transport={transport}>
          <Connection.Flow domain="mail.example.com" />
        </DomainKit.Root>,
      ),
    ).toContain("Detecting DNS provider");
  });
});
