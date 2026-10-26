import { Connect } from "../src/index.ts";
import { mount, run, scenario, until } from "./harness.tsx";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("default interactive return destination", () => {
  for (const surface of ["domain", "accounts"] as const) {
    for (const command of ["connect", "reconnect"] as const) {
      it(`${surface} ${command} drops recovery hints without changing the current page`, async () => {
        const { domain, transport } = scenario({ provider: { oauth: true } });
        const hook: () => Connect.Controller | Connect.AccountsController =
          surface === "domain"
            ? () => Connect.useController({ domain })
            : () => Connect.useAccounts();
        const view = mount(transport, hook);
        await until(() => expect(view.result.current.providers).toHaveLength(1));
        const state = { host: "domains" };
        window.history.replaceState(
          state,
          "",
          "/settings?keep=one&domainkit=cancelled&keep=two&domainkit=inspect&domainkit-provider=fake&domainkit-connection=old&domainkit-connection=other#accounts",
        );
        const current = window.location.href;
        const entries = window.history.length;
        await run(() => {
          if (command === "connect") {
            view.result.current.connect({ provider: "fake", method: "oauth" });
          } else {
            view.result.current.reconnect({
              connectionId: "existing",
              provider: "fake",
              method: "oauth",
            });
          }
        });
        const method = command === "connect" ? "connection.start" : "connection.reconnect";
        await until(() =>
          expect(transport.calls.find((call) => call.method === method)).toBeDefined(),
        );
        expect(transport.calls.find((call) => call.method === method)?.input).toMatchObject({
          ...(command === "reconnect" ? { connectionId: "existing" } : {}),
          method: {
            _tag: "OAuth",
            returnTo: `${window.location.origin}/settings?keep=one&keep=two#accounts`,
          },
        });
        expect(window.location.href).toBe(current);
        expect(window.history.state).toEqual(state);
        expect(window.history.length).toBe(entries);
      });
    }
  }
});
