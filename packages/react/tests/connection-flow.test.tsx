import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { renderToString } from "react-dom/server";

import { Connection, DomainKit, Testing } from "../src/index.ts";

afterEach(cleanup);

const disconnected = (reusable = false) => ({
  _tag: "Disconnected" as const,
  domain: "mail.example.com",
  provider: Testing.provider(),
  ...(reusable
    ? { reusableConnection: { connectionId: "connection-1", label: "existing account" } }
    : {}),
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
        connect: () => Effect.die("not used"),
        inspect: ({ domain }) => Effect.succeed({ _tag: "Unsupported", domain }),
        removeDomain: () => Effect.die("not used"),
        reuse: () => Effect.die("not used"),
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

  it("reuses a provider authorization without another OAuth round trip", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: disconnected(true) });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Use existing account" }));

    expect(await screen.findByText("Cloudflare connected")).toBeTruthy();
    expect(transport.calls.reuse).toEqual([
      { connectionId: "connection-1", domain: "mail.example.com" },
    ]);
    expect(transport.calls.connect).toEqual([]);
  });

  it("renders an existing connection without prompting", async () => {
    const transport = Testing.makeFakeTransport({
      inspect: {
        _tag: "Connected",
        connectionId: "connection-1",
        domain: "mail.example.com",
        provider: Testing.provider(),
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
    pending.resolve({
      _tag: "Connected",
      connectionId: "connection-1",
      domain: "mail.example.com",
      provider: Testing.provider(),
    });

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
