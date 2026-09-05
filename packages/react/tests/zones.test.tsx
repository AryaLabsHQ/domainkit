import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";
import { useState } from "react";

import { Connect, DomainKit, Testing } from "../src/index.ts";
import { mount, run, until } from "./harness.tsx";

/** One zone set per case: fake providers share a process-wide zone table. */
let cases = 0;
const scenario = (options: { readonly oauth?: boolean } = {}) => {
  const suffix = `field${(cases += 1)}`;
  const zones = [`${suffix}-one.example`, `${suffix}-two.example`];
  return {
    transport: Testing.transport({
      provider: {
        labels: Object.fromEntries(zones.map((zone) => [zone, `${zone} (Acme)`])),
        ...(options.oauth === true ? { oauth: true } : {}),
        zones,
      },
    }),
    zones,
  };
};

const user = userEvent.setup({ delay: null });

/** Connect an account with no domain of its own, which is what the picker lists zones from. */
const connectAccount = async (transport: Transport.Interface) => {
  const connection = transport.connection;
  if (connection === undefined) throw new Error("The fake transport has no connection group");
  await Effect.runPromise(
    connection.start({ method: Transport.Method.token("tok"), provider: "fake" }),
  );
};

describe("Connect.useZones", () => {
  it("lists every zone this owner's connections reach", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    const view = mount(transport, () => Connect.useZones());
    await until(() => expect(view.result.current.state._tag).toBe("Ready"));
    expect(view.result.current.zones.map((zone) => zone.zone).sort()).toEqual([...zones].sort());
    expect(view.result.current.connections).toHaveLength(1);
    expect(view.result.current.providers.map((provider) => provider.id)).toEqual(["fake"]);
  });

  it("lists no zone before an account is connected", async () => {
    const { transport } = scenario();
    const view = mount(transport, () => Connect.useZones());
    await until(() => expect(view.result.current.state._tag).toBe("Ready"));
    expect(view.result.current.zones).toEqual([]);
    expect(view.result.current.connections).toEqual([]);
  });
});

describe("Connect.useAccounts", () => {
  it("connects a provider with no domain named, then lists what it reaches", async () => {
    const { transport, zones } = scenario();
    const view = mount(transport, () => Connect.useAccounts(), { navigate: () => {} });
    await until(() => expect(view.result.current.state._tag).toBe("Ready"));
    expect(view.result.current.connections).toEqual([]);

    await run(() =>
      view.result.current.connect({
        method: "token",
        provider: "fake",
        values: { token: "tok" },
      }),
    );
    await until(() => expect(view.result.current.zones.length).toBe(zones.length));
    // A connection granted without a domain is the account itself, so nothing was attached.
    expect(transport.calls.some((call) => call.method === "connection.attach")).toBe(false);
    expect(
      transport.calls.find((call) => call.method === "connection.start")?.input,
    ).not.toHaveProperty("domain");
  });

  it("re-credits an account the provider turned down rather than adding a second", async () => {
    const { transport } = scenario();
    await connectAccount(transport);
    const view = mount(transport, () => Connect.useAccounts(), { navigate: () => {} });
    await until(() => expect(view.result.current.connections).toHaveLength(1));
    const connectionId = view.result.current.connections[0]?.connectionId;
    if (connectionId === undefined) throw new Error("The listing named no connection");
    await run(() =>
      view.result.current.reconnect({
        connectionId,
        method: "token",
        provider: "fake",
        values: { token: "again" },
      }),
    );
    await until(() =>
      expect(transport.calls.some((call) => call.method === "connection.reconnect")).toBe(true),
    );
    expect(transport.calls.filter((call) => call.method === "connection.start")).toHaveLength(1);
  });
});

describe("Connect.placementOf and Connect.completionOf", () => {
  const zone = (name: string, connectionId = "c1") => ({
    connectionId,
    label: `${name} (Acme)`,
    provider: "fake",
    zone: name,
  });

  it("places a value in the longest zone that holds it", () => {
    const zones = [zone("example.com"), zone("dev.example.com", "c2")];
    expect(Connect.placementOf("mail.dev.example.com", zones)?.zone.zone).toBe("dev.example.com");
    expect(Connect.placementOf("mail.example.com", zones)?.zone.zone).toBe("example.com");
    expect(Connect.placementOf("elsewhere.test", zones)).toBeNull();
    expect(Connect.placementOf("", zones)).toBeNull();
  });

  it("prefers the account the customer completed from among two that serve the zone", () => {
    const zones = [zone("example.com", "first"), zone("example.com", "second")];
    expect(Connect.placementOf("mail.example.com", zones)?.placement.connectionId).toBe("first");
    expect(
      Connect.placementOf("mail.example.com", zones, {
        connectionId: "second",
        zone: "example.com",
      })?.placement.connectionId,
    ).toBe("second");
  });

  it("keeps the subdomain the customer typed in front of the zone it completes", () => {
    const only = zone("example.com");
    expect(Connect.suggestionsFor("mail.ex", [only])).toHaveLength(1);
    expect(Connect.completionOf("mail.ex", only)).toBe("mail.example.com");
    expect(Connect.completionOf("ex", only)).toBe("example.com");
    expect(Connect.suggestionsFor("nothing.here", [only])).toEqual([]);
  });
});

describe("Connect.useDomainField", () => {
  function Field({
    onResolve,
    transport,
  }: {
    readonly transport: Transport.Interface;
    readonly onResolve?: Connect.DomainFieldOptions["onResolve"];
  }) {
    const [value, setValue] = useState("");
    const zones = Connect.useZones();
    const field = Connect.useDomainField({
      onChange: setValue,
      value,
      zones: zones.zones,
      ...(onResolve === undefined ? {} : { onResolve }),
    });
    return (
      <div>
        <input {...field.inputProps} />
        <ul {...field.listboxProps}>
          {field.suggestions.map((zone) => (
            <li key={`${zone.connectionId}:${zone.zone}`} {...field.optionProps(zone)}>
              {zone.zone}
            </li>
          ))}
        </ul>
        <output data-testid="value">{value}</output>
        <output data-testid="account">{field.found?.zone.label ?? "none"}</output>
      </div>
    );
  }

  const harness = (
    transport: Transport.Interface,
    onResolve?: Connect.DomainFieldOptions["onResolve"],
  ) =>
    render(
      <DomainKit.Root navigate={() => {}} transport={transport}>
        <Field transport={transport} {...(onResolve === undefined ? {} : { onResolve })} />
      </DomainKit.Root>,
    );

  const combobox = () => screen.getByRole("combobox");
  const options = () => screen.queryAllByRole("option");
  const value = () => screen.getByTestId("value").textContent;

  it("filters the zones as the customer types and completes on Tab", async () => {
    const { transport, zones } = scenario();
    const [one] = zones;
    if (one === undefined) throw new Error("The scenario listed no zone");
    await connectAccount(transport);
    harness(transport);
    await user.click(combobox());
    await until(() => expect(options()).toHaveLength(2));
    await user.type(combobox(), one.slice(0, 8));
    await until(() => expect(options()).toHaveLength(1));
    await user.tab();
    expect(value()).toBe(one);
  });

  it("keeps the subdomain the customer typed in front of the zone it completes", async () => {
    const { transport, zones } = scenario();
    const [, two] = zones;
    if (two === undefined) throw new Error("The scenario listed one zone only");
    await connectAccount(transport);
    harness(transport);
    await user.click(combobox());
    await until(() => expect(options()).toHaveLength(2));
    await user.type(combobox(), `mail.${two.slice(0, 8)}`);
    await until(() => expect(options()).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(value()).toBe(`mail.${two}`);
  });

  it("moves the highlight with the arrow keys and closes the list on Escape", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    harness(transport);
    await user.click(combobox());
    await until(() => expect(options()).toHaveLength(2));
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowUp}");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Escape}");
    expect(combobox().getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{Tab}");
    // Escape closed the list, so Tab moves on rather than completing the name.
    expect(value()).toBe("");
    expect(zones).toHaveLength(2);
  });

  it("names the account a resolved domain's records go to, and reports it to the host", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    const resolved: Array<{ domain: string; connection: Connect.Placement | null }> = [];
    harness(transport, (input) => resolved.push({ ...input }));
    await user.click(screen.getByRole("combobox"));
    await until(() => expect(options()).toHaveLength(2));
    await user.type(screen.getByRole("combobox"), `mail.${zones[0]}`);
    await until(() => expect(screen.getByTestId("account").textContent).toBe(`${zones[0]} (Acme)`));
    await until(() =>
      expect(resolved.at(-1)).toMatchObject({
        connection: { zone: zones[0] },
        domain: `mail.${zones[0]}`,
      }),
    );
  });

  it("says nothing about an account for a domain outside every connected zone", async () => {
    const { transport } = scenario();
    await connectAccount(transport);
    harness(transport);
    await user.type(screen.getByRole("combobox"), "mail.elsewhere.test");
    await until(() => expect(screen.getByTestId("account").textContent).toBe("none"));
    expect(options()).toEqual([]);
  });

  it("completes from the account the customer picked when two of them serve the zone", async () => {
    const suffix = `shared${(cases += 1)}`;
    const zone = `${suffix}.example`;
    const transport = Testing.transport({ provider: { zones: [zone] } });
    await connectAccount(transport);
    await connectAccount(transport);
    const view = mount(transport, () => {
      const zones = Connect.useZones();
      return {
        field: Connect.useDomainField({ onChange: () => {}, value: "", zones: zones.zones }),
        zones,
      };
    });
    await until(() => expect(view.result.current.zones.zones).toHaveLength(2));
    const second = view.result.current.zones.zones[1];
    if (second === undefined) throw new Error("The listing named one account only");
    act(() => view.result.current.field.complete(second));
    // Two accounts reach the same zone, so which one the records go to is the customer's choice.
    expect(second.zone).toBe(zone);
  });
});
