import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    await user.click(await screen.findByRole("button", { name: "Connect Cloudflare" }));
    await user.click(screen.getByRole("button", { name: "Continue with OAuth" }));

    await waitFor(() => expect(navigations).toEqual(["https://dash.cloudflare.com/oauth2/auth"]));
    expect(transport.calls.connect).toEqual([
      {
        domain: "mail.example.com",
        method: "oauth",
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

    await user.click(await screen.findByRole("button", { name: "Connect Cloudflare" }));
    await user.type(screen.getByLabelText("API token"), "secret-token");
    await user.click(screen.getByRole("button", { name: "Connect with token" }));

    expect(await screen.findByText("Cloudflare connected")).toBeTruthy();
    expect(transport.calls.connect).toEqual([
      {
        domain: "mail.example.com",
        method: "token",
        providerId: "cloudflare",
        token: "secret-token",
      },
    ]);
  });

  it("reuses a provider authorization without another OAuth round trip", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: disconnected(true) });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Connect Cloudflare" }));
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
    expect(screen.queryByRole("button", { name: "Connect Cloudflare" })).toBeNull();
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
    expect(await screen.findByText("Cloudflare is available")).toBeTruthy();
    expect(transport.calls.inspect).toHaveLength(2);
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
