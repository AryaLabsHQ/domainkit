import { act, cleanup, renderHook } from "@testing-library/react";
import { CallbackRecovery } from "domainkit/client";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { Connect, Messages } from "../src/index.ts";
import { mount, run, scenario, until } from "./harness.tsx";

const show = (outcome: CallbackRecovery.Model): void => {
  window.history.replaceState(
    null,
    "",
    CallbackRecovery.write(new URL(window.location.href), outcome),
  );
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Connect.useRecovery", () => {
  it.each(["cancelled", "restart", "inspect"] as const)("reads a %s callback hint", (kind) => {
    show({ kind, provider: "cloudflare" });
    const view = renderHook(() => Connect.useRecovery());
    expect(view.result.current.outcome).toEqual({ kind, provider: "cloudflare" });
  });

  it.each(["cancelled", "restart", "inspect"] as const)("retains a %s reconnect hint", (kind) => {
    show({ kind, provider: "fake", connectionId: "existing-connection" });
    const view = renderHook(() => Connect.useRecovery());
    expect(view.result.current.outcome).toEqual({
      kind,
      provider: "fake",
      connectionId: "existing-connection",
    });
    act(() => view.result.current.dismiss());
    expect(view.result.current.outcome).toBeNull();
    expect(new URL(window.location.href).searchParams.has("domainkit-connection")).toBe(false);
  });

  it.each([
    "/?domainkit=cancelled",
    "/?domainkit-provider=fake",
    "/?domainkit=unknown&domainkit-provider=fake",
    "/?domainkit=restart&domainkit-provider=",
    "/?domainkit=restart&domainkit-provider=fake&domainkit-connection=",
    "/?domainkit=restart&domainkit-provider=fake&domainkit-connection=one&domainkit-connection=two",
    "/?domainkit=cancelled&domainkit=inspect&domainkit-provider=fake",
  ])("ignores malformed input %s", (url) => {
    window.history.replaceState(null, "", url);
    expect(renderHook(() => Connect.useRecovery()).result.current.outcome).toBeNull();
  });

  it("dismisses across mounted readers while preserving history state, query, hash, and entry count", () => {
    window.history.replaceState(
      { host: { route: "domains" } },
      "",
      "/settings?tab=dns&tab=accounts#provider",
    );
    const state = window.history.state;
    window.history.replaceState(
      state,
      "",
      CallbackRecovery.write(new URL(window.location.href), {
        kind: "restart",
        provider: "fake",
        connectionId: "existing-connection",
      }),
    );
    const length = window.history.length;
    const replace = vi.spyOn(window.history, "replaceState");
    const first = renderHook(() => Connect.useRecovery());
    const second = renderHook(() => Connect.useRecovery());
    act(() => first.result.current.dismiss());
    expect(first.result.current.outcome).toBeNull();
    expect(second.result.current.outcome).toBeNull();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/settings?tab=dns&tab=accounts#provider",
    );
    expect(window.history.state).toEqual(state);
    expect(replace.mock.calls[0]?.[0]).toBe(state);
    expect(window.history.length).toBe(length);
  });

  it("reads the latest URL on history events and host router rerenders", () => {
    const view = renderHook(() => Connect.useRecovery());
    show({ kind: "inspect", provider: "vercel" });
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(view.result.current.outcome).toEqual({ kind: "inspect", provider: "vercel" });
    show({ kind: "restart", provider: "cloudflare" });
    view.rerender();
    expect(view.result.current.outcome).toEqual({ kind: "restart", provider: "cloudflare" });
    window.history.replaceState(null, "", "/another-page");
    act(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(view.result.current.outcome).toBeNull();
  });

  it("dismisses the current URL even if a router moved since the last render", () => {
    show({ kind: "cancelled", provider: "fake" });
    const view = renderHook(() => Connect.useRecovery());
    window.history.replaceState({ page: 2 }, "", "/other?keep=yes#new");
    show({ kind: "inspect", provider: "vercel" });
    act(() => view.result.current.dismiss());
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/other?keep=yes#new",
    );
    expect(view.result.current.outcome).toBeNull();
  });

  it("server-renders without accessing window and hydrates the current URL without a mismatch", async () => {
    show({ kind: "inspect", provider: "fake" });
    function Hint() {
      return <span>{Connect.useRecovery().outcome?.kind ?? "none"}</span>;
    }
    const windowRead = vi.spyOn(globalThis, "window", "get").mockImplementation(() => {
      throw new Error("Server render accessed window");
    });
    let html: string;
    try {
      html = renderToString(<Hint />);
    } finally {
      windowRead.mockRestore();
    }
    expect(html).toBe("<span>none</span>");
    const container = document.createElement("div");
    container.innerHTML = html;
    const recoverable = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Hint />, { onRecoverableError: recoverable });
    });
    expect(container.textContent).toBe("inspect");
    expect(recoverable).not.toHaveBeenCalled();
    act(() => root?.unmount());
  });

  it("supplies the recovered provider and clean current URL to the existing connect controller", async () => {
    const { domain, transport } = scenario({ provider: { oauth: true } });
    show({ kind: "restart", provider: "fake" });
    const navigate = vi.fn();
    const view = mount(
      transport,
      () => ({
        recovery: Connect.useRecovery(),
        connection: Connect.useController({ domain }),
      }),
      { navigate },
    );
    await until(() => expect(view.result.current.connection.providers).toHaveLength(1));
    await run(() => {
      const outcome = view.result.current.recovery.outcome;
      if (outcome === null) throw new Error("Missing recovery hint");
      view.result.current.recovery.dismiss();
      view.result.current.connection.connect({ provider: outcome.provider, method: "oauth" });
    });
    // This boundary proves the request; the registry browser spec exercises the real redirect.
    await until(() =>
      expect(transport.calls.find((call) => call.method === "connection.start")).toBeDefined(),
    );
    expect(transport.calls.find((call) => call.method === "connection.start")?.input).toMatchObject(
      {
        provider: "fake",
        method: { _tag: "OAuth", returnTo: window.location.href },
      },
    );
    expect(CallbackRecovery.read(new URL(window.location.href))).toBeNull();
  });
});

describe("recovery messages", () => {
  it("keeps account inspection guidance distinct from starting another attempt and supports overrides", () => {
    expect(Messages.english.recoveryCancelled("Cloudflare").title).toContain("Cloudflare");
    expect(Messages.english.recoveryRestart("Vercel").description).toContain("new one");
    expect(Messages.english.recoveryInspect("Vercel").description).toContain("before trying again");
    const catalog = Messages.merge({
      dismissRecovery: "Hide",
      recoveryInspect: () => ({ title: "Accounts", description: "Inspect first." }),
    });
    expect(catalog.recoveryInspect("Vercel")).toEqual({
      title: "Accounts",
      description: "Inspect first.",
    });
    expect(catalog.dismissRecovery).toBe("Hide");
    expect(catalog.retry).toBe("Try again");
  });
});
