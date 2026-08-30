import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transport } from "domainkit";

import { Connection, DomainKit, Lifecycle, Provisioning, Testing } from "../src/index.ts";

afterEach(cleanup);

const connection = {
  _tag: "Connected" as const,
  connectionId: "connection-1",
  domain: "example.com",
  provider: Testing.provider(),
};

const record: Transport.DnsRecord = {
  id: "dkim",
  name: "selector._domainkey.example.com",
  type: "TXT",
  value: "v=DKIM1; p=public-key",
};

describe("host lifecycle events", () => {
  it("keeps an active model stable when an inline listener changes", async () => {
    const user = userEvent.setup();
    const events: Array<Lifecycle.Event> = [];
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const { rerender } = render(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Review changes",
    });

    rerender(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(within(dialog).getByRole("button", { name: "Add records" }));
    expect(await screen.findByText("DNS changes applied")).toBeTruthy();
    expect(events.map((event) => event._tag)).toEqual(["RecordsApplied"]);
  });

  it("commits disconnect state before notifying a throwing listener", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root
        onEvent={() => {
          throw new Error("observer failed");
        }}
        transport={transport}
      >
        <Connection.DisconnectAction connection={connection} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByText(/Domain disconnected/)).toBeTruthy());
    expect(transport.calls.removeDomain).toEqual([
      {
        connectionId: connection.connectionId,
        domain: connection.domain,
        preserveDns: true,
      },
    ]);
  });
});
