import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Connection, DomainKit, Provider, Testing, Theme } from "../src/index.ts";

afterEach(cleanup);

const disconnected = {
  _tag: "Disconnected" as const,
  domain: "mail.example.com",
  provider: Testing.provider(),
};

describe("composition and theme", () => {
  it("maps the typed theme to the canonical CSS variables", () => {
    const style = Theme.toStyle({ accent: "#7c3aed", radius: "1rem" });
    expect(style).toEqual({
      "--domainkit-accent": "#7c3aed",
      "--domainkit-radius": "1rem",
    });
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const { container } = render(
      <DomainKit.Root
        colorScheme="dark"
        theme={{ accent: "#7c3aed", radius: "1rem" }}
        transport={transport}
      >
        <div>Child</div>
      </DomainKit.Root>,
    );
    const root = container.querySelector<HTMLElement>("[data-domainkit-root]");
    expect(root?.dataset.colorScheme).toBe("dark");
    expect(root?.style.getPropertyValue("--domainkit-accent")).toBe("#7c3aed");
    expect(root?.style.getPropertyValue("--domainkit-radius")).toBe("1rem");
  });

  it("merges host render props without duplicating the DomainKit action", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const controller: Connection.Controller = {
      connect: async () => {
        calls += 1;
      },
      retry: () => undefined,
      reuse: async () => undefined,
      state: disconnected,
    };
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.OAuthAction
          controller={controller}
          label="Authorize"
          render={<button data-host-button="" />}
        />
      </DomainKit.Root>,
    );
    const action = screen.getByRole("button", { name: "Authorize" });
    expect(action.hasAttribute("data-host-button")).toBe(true);
    await user.click(action);
    expect(calls).toBe(1);
  });

  it("lets host props override component defaults", () => {
    const controller: Connection.Controller = {
      connect: async () => undefined,
      retry: () => undefined,
      reuse: async () => undefined,
      state: disconnected,
    };
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.OAuthAction controller={controller} label="Authorize" type="submit">
          Host action
        </Connection.OAuthAction>
      </DomainKit.Root>,
    );
    const action = screen.getByRole("button", { name: "Host action" });
    expect(action.getAttribute("type")).toBe("submit");
  });

  it("overrides messages and provider marks through the package root", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root
        marks={{ cloudflare: <span>Custom provider mark</span> }}
        messages={{ connectProvider: (provider) => `Authorize ${provider}` }}
        transport={transport}
      >
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Cloudflare" }));
    expect(screen.getByText("Custom provider mark")).toBeTruthy();
  });

  it("ports dialogs into an HTMLElement owned by the host", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const host = document.createElement("div");
    document.body.append(host);
    const first = render(
      <DomainKit.Root portalContainer={host} transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    fireEvent.click(await first.findByRole("button", { name: "Connect Cloudflare" }));
    expect(host.querySelector('[data-domainkit-part="connection-dialog"]')).toBeTruthy();
    first.unmount();
  });

  it("loads known provider marks from integrations.sh and falls back to a letter", () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Provider.Mark provider={Testing.provider({ id: "vercel", name: "Vercel" })} />
      </DomainKit.Root>,
    );
    const vercel = screen.getByRole("img", { name: "Vercel" });
    expect(vercel.querySelector("img")?.getAttribute("src")).toBe(
      "https://integrations.sh/logo/vercel.com?sz=64",
    );
    rerender(
      <DomainKit.Root transport={transport}>
        <Provider.Mark provider={Testing.provider({ id: "other", name: "Other" })} />
      </DomainKit.Root>,
    );
    expect(screen.getByRole("img", { name: "Other" }).textContent).toBe("O");
  });
});
