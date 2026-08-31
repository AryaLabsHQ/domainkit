import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Connection, DomainKit, Provider, Records, Testing, Theme } from "../src/index.ts";

afterEach(cleanup);

const disconnected = {
  _tag: "Disconnected" as const,
  domain: "mail.example.com",
  provider: Testing.provider(),
  reusableConnections: [],
};

describe("composition and theme", () => {
  it("maps the typed theme to the canonical CSS variables", () => {
    const style = Theme.toStyle({
      accent: "#7c3aed",
      backdrop: "rgb(12 10 9 / 0.6)",
      dangerContrast: "#111111",
      radius: "1rem",
    });
    expect(style).toEqual({
      "--domainkit-accent": "#7c3aed",
      "--domainkit-backdrop": "rgb(12 10 9 / 0.6)",
      "--domainkit-danger-contrast": "#111111",
      "--domainkit-radius": "1rem",
    });
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const { container } = render(
      <DomainKit.Root
        colorScheme="dark"
        theme={{
          accent: "#7c3aed",
          backdrop: "rgb(12 10 9 / 0.6)",
          dangerContrast: "#111111",
          radius: "1rem",
        }}
        transport={transport}
      >
        <div>Child</div>
      </DomainKit.Root>,
    );
    const root = container.querySelector<HTMLElement>("[data-domainkit-root]");
    expect(root?.dataset.colorScheme).toBe("dark");
    expect(root?.style.getPropertyValue("--domainkit-accent")).toBe("#7c3aed");
    expect(root?.style.getPropertyValue("--domainkit-backdrop")).toBe("rgb(12 10 9 / 0.6)");
    expect(root?.style.getPropertyValue("--domainkit-danger-contrast")).toBe("#111111");
    expect(root?.style.getPropertyValue("--domainkit-radius")).toBe("1rem");
  });

  it("lets Root replace the default record icons", () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root icons={{ copy: <span>host-copy</span> }} transport={transport}>
        <Records.CopyValue value="v=spf1" />
      </DomainKit.Root>,
    );
    expect(screen.getByText("host-copy")).toBeTruthy();
  });

  it("merges host render props without duplicating the DomainKit action", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const controller: Connection.Controller = {
      attach: () => undefined,
      connect: async () => {
        calls += 1;
      },
      detach: () => undefined,
      retry: () => undefined,
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
      attach: () => undefined,
      connect: async () => undefined,
      detach: () => undefined,
      retry: () => undefined,
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
    const trigger = await screen.findByRole("button", { name: "Authorize Cloudflare" });
    expect(trigger.querySelector('[data-domainkit-part="provider-mark"]')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getAllByText("Custom provider mark").length).toBeGreaterThan(0);
  });

  it("ports dialogs into an HTMLElement owned by the host", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const host = document.createElement("div");
    document.body.append(host);
    const first = render(
      <DomainKit.Root
        portalContainer={host}
        theme={{ backdrop: "rgb(12 10 9 / 0.6)" }}
        transport={transport}
      >
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    fireEvent.click(await first.findByRole("button", { name: "Connect" }));
    expect(host.querySelector('[data-domainkit-part="connection-dialog"]')).toBeTruthy();
    const backdrop = host.querySelector<HTMLElement>('[data-domainkit-part="dialog-backdrop"]');
    expect(backdrop?.style.getPropertyValue("--domainkit-backdrop")).toBe("rgb(12 10 9 / 0.6)");
    first.unmount();
  });

  it("falls back to the document for portal containers inside a ShadowRoot", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadow.append(container);

    render(
      <DomainKit.Root portalContainer={container} transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Connect(?: Cloudflare)?$/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(container.querySelector('[data-domainkit-part="connection-dialog"]')).toBeNull();
  });

  it("moves an open dialog back to the document when its portal enters a ShadowRoot", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const container = document.createElement("div");
    document.body.append(container);
    render(
      <DomainKit.Root portalContainer={container} transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Connect(?: Cloudflare)?$/ }));
    expect(container.querySelector('[data-domainkit-part="connection-dialog"]')).toBeTruthy();
    const shadowHost = document.createElement("div");
    const shadow = shadowHost.attachShadow({ mode: "open" });
    shadow.append(container);
    await waitFor(() => {
      expect(container.querySelector('[data-domainkit-part="connection-dialog"]')).toBeNull();
      expect(document.body.querySelector('[data-domainkit-part="connection-dialog"]')).toBeTruthy();
    });
  });

  it("moves an open dialog back when its portal is adopted by another document", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const container = document.createElement("div");
    document.body.append(container);
    render(
      <DomainKit.Root portalContainer={container} transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Connect(?: Cloudflare)?$/ }));
    expect(container.querySelector('[data-domainkit-part="connection-dialog"]')).toBeTruthy();

    const otherDocument = document.implementation.createHTMLDocument("Other");
    otherDocument.body.append(otherDocument.adoptNode(container));

    await waitFor(() => {
      expect(container.querySelector('[data-domainkit-part="connection-dialog"]')).toBeNull();
      expect(document.body.querySelector('[data-domainkit-part="connection-dialog"]')).toBeTruthy();
    });
  });

  it("uses bundled marks before the local letter fallback", () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Provider.Mark provider={Testing.provider({ id: "vercel", name: "Vercel" })} />
      </DomainKit.Root>,
    );
    const vercel = screen.getByRole("img", { name: "Vercel" });
    expect(vercel.querySelector("svg")).toBeTruthy();
    expect(vercel.querySelector("img")).toBeNull();
    rerender(
      <DomainKit.Root transport={transport}>
        <Provider.Mark provider={Testing.provider({ id: "cloudflare", name: "Cloudflare" })} />
      </DomainKit.Root>,
    );
    const cloudflare = screen.getByRole("img", { name: "Cloudflare" });
    expect(cloudflare.querySelector("svg")).toBeTruthy();
    expect(cloudflare.querySelector("img")).toBeNull();
    rerender(
      <DomainKit.Root transport={transport}>
        <Provider.Mark provider={Testing.provider({ id: "other", name: "Other" })} />
      </DomainKit.Root>,
    );
    expect(screen.getByRole("img", { name: "Other" }).textContent).toBe("O");
  });

  it("lets Trigger children replace the default label without injecting a mark", () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root transport={transport}>
        <BaseDialog.Root>
          <Connection.Trigger>Host connect</Connection.Trigger>
        </BaseDialog.Root>
      </DomainKit.Root>,
    );
    const trigger = screen.getByRole("button", { name: "Host connect" });
    expect(trigger.querySelector('[data-domainkit-part="provider-mark"]')).toBeNull();
    expect(trigger.hasAttribute("data-domainkit-recipe")).toBe(false);
  });

  it("keeps host trigger chrome off a render button", () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root transport={transport}>
        <BaseDialog.Root>
          <Connection.Trigger render={<button data-host-button="" />}>
            Connect Cloudflare
          </Connection.Trigger>
        </BaseDialog.Root>
      </DomainKit.Root>,
    );
    const trigger = screen.getByRole("button", { name: "Connect Cloudflare" });
    expect(trigger.hasAttribute("data-host-button")).toBe(true);
    expect(trigger.hasAttribute("data-domainkit-recipe")).toBe(false);
    expect(trigger.querySelector('[data-domainkit-part="provider-mark"]')).toBeNull();
  });

  it("keeps the Flow recipe trigger as a marked, styled control", async () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Flow domain="mail.example.com" />
      </DomainKit.Root>,
    );
    const trigger = await screen.findByRole("button", { name: "Connect" });
    expect(trigger.getAttribute("data-domainkit-recipe")).toBe("connect");
    expect(trigger.querySelector('[data-domainkit-part="provider-mark"]')).toBeTruthy();
  });

  it("lets Status children replace the disconnected copy", () => {
    const transport = Testing.makeFakeTransport({ inspect: disconnected });
    render(
      <DomainKit.Root transport={transport}>
        <Connection.Status state={disconnected}>Owns DNS for this domain.</Connection.Status>
      </DomainKit.Root>,
    );
    expect(screen.getByText("Owns DNS for this domain.")).toBeTruthy();
    expect(screen.queryByText("Cloudflare manages DNS for this domain")).toBeNull();
  });
});
