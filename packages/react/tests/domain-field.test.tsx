import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";
import { useState } from "react";

import { Connect, DomainKit, Testing } from "../src/index.ts";

/** One zone set per case: fake providers share a process-wide zone table. */
let cases = 0;
const scenario = (options: { readonly oauth?: boolean } = {}) => {
  const suffix = `field${(cases += 1)}`;
  const zones = [`${suffix}-one.example`, `${suffix}-two.example`];
  return {
    transport: Testing.transport({
      provider: {
        labels: {
          [`${suffix}-one.example`]: `${suffix}-one.example (Acme)`,
          [`${suffix}-two.example`]: `${suffix}-two.example (Acme)`,
        },
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

function Harness({
  onResolve,
  transport,
}: {
  readonly transport: Transport.Interface;
  readonly onResolve?: Parameters<typeof Connect.DomainField>[0]["onResolve"];
}) {
  const [value, setValue] = useState("");
  return (
    <DomainKit.Root navigate={() => {}} transport={transport}>
      <Connect.DomainField
        onChange={setValue}
        value={value}
        {...(onResolve === undefined ? {} : { onResolve })}
      />
      <output data-testid="value">{value}</output>
    </DomainKit.Root>
  );
}

const input = () => screen.getByRole("combobox");
const options = () => screen.queryAllByRole("option");
const footer = () => document.querySelector("[data-domainkit-part='domain-field-footer']");

describe("Connect.useZones", () => {
  it("lists every zone this owner's connections reach", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    const seen: Array<Connect.ZonesState> = [];
    function Reader() {
      const listing = Connect.useZones();
      seen.push(listing.state);
      return <output data-testid="zones">{listing.zones.map(({ zone }) => zone).join(",")}</output>;
    }
    render(
      <DomainKit.Root transport={transport}>
        <Reader />
      </DomainKit.Root>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("zones").textContent).toBe([...zones].sort().join(",")),
    );
    expect(seen[0]?._tag).toBe("Loading");
  });
});

describe("Connect.DomainField", () => {
  it("filters the zones as the customer types and completes on Tab", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    render(<Harness transport={transport} />);
    await user.click(input());
    await waitFor(() => expect(options()).toHaveLength(2));

    const [first] = [...zones].sort();
    if (first === undefined) throw new Error("the scenario has no zones");
    await user.type(input(), first.slice(0, 12));
    await waitFor(() => expect(options()).toHaveLength(1));
    await user.tab();
    expect(screen.getByTestId("value").textContent).toBe(first);
  });

  it("keeps the subdomain the customer typed in front of the zone it completes", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    render(<Harness transport={transport} />);
    const [first] = [...zones].sort();
    if (first === undefined) throw new Error("the scenario has no zones");
    await user.click(input());
    await user.type(input(), `mail.${first.slice(0, 10)}`);
    await waitFor(() => expect(options()).toHaveLength(1));
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("value").textContent).toBe(`mail.${first}`);
  });

  it("moves the highlight with the arrow keys and closes the list on Escape", async () => {
    const { transport } = scenario();
    await connectAccount(transport);
    render(<Harness transport={transport} />);
    await user.click(input());
    await waitFor(() => expect(options()).toHaveLength(2));
    const listed = options();
    expect(input().getAttribute("aria-activedescendant")).toBe(listed[0]?.id);
    await user.keyboard("{ArrowDown}");
    expect(input().getAttribute("aria-activedescendant")).toBe(listed[1]?.id);
    await user.keyboard("{ArrowUp}");
    expect(input().getAttribute("aria-activedescendant")).toBe(listed[0]?.id);
    await user.keyboard("{Escape}");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(options()).toHaveLength(0);
  });

  it("names the account a resolved domain's records go to, and reports it to the host", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    const resolved: Array<{
      readonly domain: string;
      readonly connection: Connect.Placement | null;
    }> = [];
    render(<Harness onResolve={(reported) => resolved.push(reported)} transport={transport} />);
    const [first] = [...zones].sort();
    if (first === undefined) throw new Error("the scenario has no zones");
    await user.click(input());
    await user.type(input(), `mail.${first}`);
    await waitFor(() =>
      expect(footer()?.textContent).toBe(`Records go to Fake fake through ${first} (Acme).`),
    );
    const last = resolved.at(-1);
    expect(last?.domain).toBe(`mail.${first}`);
    expect(last?.connection?.zone).toBe(first);
  });

  it("keeps the account the customer completed from when two of them serve the zone", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    await connectAccount(transport);
    const resolved: Array<{
      readonly domain: string;
      readonly connection: Connect.Placement | null;
    }> = [];
    render(<Harness onResolve={(reported) => resolved.push(reported)} transport={transport} />);
    const [first] = [...zones].sort();
    if (first === undefined) throw new Error("the scenario has no zones");
    await user.click(input());
    await user.type(input(), `mail.${first.slice(0, 10)}`);
    // Two accounts serve the same zone, so the listing holds the zone twice.
    await waitFor(() => expect(options()).toHaveLength(2));
    const second = options()[1];
    if (second === undefined) throw new Error("the listing holds one account");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("value").textContent).toBe(`mail.${first}`);
    // The domain alone cannot say which account it goes to, so the field remembers the choice.
    const last = resolved.at(-1);
    expect(second.id).toContain(last?.connection?.connectionId ?? "nothing");
  });

  it("drops the account it was completed from once the value leaves that zone", async () => {
    const { transport, zones } = scenario();
    await connectAccount(transport);
    const resolved: Array<{
      readonly domain: string;
      readonly connection: Connect.Placement | null;
    }> = [];
    render(<Harness onResolve={(reported) => resolved.push(reported)} transport={transport} />);
    const [first] = [...zones].sort();
    if (first === undefined) throw new Error("the scenario has no zones");
    await user.click(input());
    await user.type(input(), first.slice(0, 12));
    await waitFor(() => expect(options()).toHaveLength(1));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(resolved.at(-1)?.connection?.zone).toBe(first));
    // The preference is a rule about the value, not a flag the field holds: a value that moves out
    // of the zone loses it however it moved.
    await user.clear(input());
    await user.type(input(), "app.elsewhere.test");
    await waitFor(() => expect(resolved.at(-1)?.connection).toBeNull());
  });

  it("says a domain outside every connected zone is one the customer adds by hand", async () => {
    const { transport } = scenario();
    await connectAccount(transport);
    render(<Harness transport={transport} />);
    await user.click(input());
    await user.type(input(), "app.elsewhere.test");
    await waitFor(() => expect(footer()?.textContent).toBe("Not in a connected account."));
    expect(options()).toHaveLength(0);
  });

  it("offers the providers when the workspace has no account yet, and starts one without a domain", async () => {
    const { transport } = scenario({ oauth: true });
    render(<Harness transport={transport} />);
    const offer = await screen.findByRole("button", { name: /Connect Fake fake/ });
    await user.click(offer);
    await waitFor(() =>
      expect(transport.calls.some((call) => call.method === "connection.start")).toBe(true),
    );
    const start = transport.calls.find((call) => call.method === "connection.start");
    // The account is what is being granted, so the start carries no domain at all.
    expect(start?.input).toMatchObject({ provider: "fake" });
    expect((start?.input as { readonly domain?: string } | undefined)?.domain).toBeUndefined();
  });

  it("asks for a token in a dialog when that is the only way in", async () => {
    const { transport } = scenario();
    render(<Harness transport={transport} />);
    await user.click(await screen.findByRole("button", { name: /Connect Fake fake/ }));
    const field = await screen.findByLabelText(/Token/);
    await user.type(field, "tok");
    await user.click(screen.getByRole("button", { name: "Connect with an API token" }));
    await waitFor(() =>
      expect(transport.calls.some((call) => call.method === "connection.start")).toBe(true),
    );
    const start = transport.calls.find((call) => call.method === "connection.start");
    expect(start?.input).toMatchObject({
      method: { _tag: "Token", values: { token: "tok" } },
      provider: "fake",
    });
    expect((start?.input as { readonly domain?: string } | undefined)?.domain).toBeUndefined();
  });

  it("offers a reconnect for an account the provider turned down", async () => {
    const { transport } = scenario();
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fake transport has no connection group");
    await connectAccount(transport);
    const listing = await Effect.runPromise(connection.zones());
    const failing: Transport.Interface = {
      ...transport,
      connection: {
        ...connection,
        zones: () =>
          Effect.succeed({
            ...listing,
            connections: listing.connections.map((entry) => ({
              ...entry,
              status: "reconnect" as const,
            })),
            zones: [],
          }),
      },
    };
    render(<Harness transport={failing} />);
    // Reconnecting is the connection's own surface: starting a provider here would add a second
    // account beside the rejected one, so the field says which account needs it and stops there.
    await waitFor(() =>
      expect(
        document.querySelector("[data-domainkit-part='domain-field-reconnect']")?.textContent,
      ).toBe("Reconnect Fake fake"),
    );
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
  });
});
