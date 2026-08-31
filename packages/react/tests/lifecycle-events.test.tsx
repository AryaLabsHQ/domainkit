import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transport } from "domainkit";

import { Connection, DomainKit, Lifecycle, Provisioning, Testing } from "../src/index.ts";

afterEach(cleanup);

const connection = Testing.connected();

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
    await waitFor(() => expect(events.map((event) => event._tag)).toEqual(["RecordsApplied"]));
  });

  it("commits disconnect state before notifying a throwing listener", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const DisconnectHarness = () => {
      const controller = Connection.useController(connection.attachment.domain);
      return (
        <>
          <span>{controller.state._tag}</span>
          {controller.state._tag === "Connected" ? (
            <button onClick={controller.detach} type="button">
              Disconnect
            </button>
          ) : null}
        </>
      );
    };
    render(
      <DomainKit.Root
        onEvent={() => {
          throw new Error("observer failed");
        }}
        transport={transport}
      >
        <DisconnectHarness />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(screen.getByText("Disconnected")).toBeTruthy());
    expect(transport.calls.detach).toEqual([
      { attachmentId: connection.attachment.id, preserveDns: true },
    ]);
  });

  it("publishes a completed apply before invoking the flow callback", async () => {
    const user = userEvent.setup();
    const events: Array<Lifecycle.Event> = [];
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Provisioning.Flow
          connection={connection}
          onApplied={() => {
            throw new Error("flow callback failed");
          }}
          records={[record]}
        />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    await user.click(within(dialog).getByRole("button", { name: "Add records" }));

    await waitFor(() => expect(events.map((event) => event._tag)).toEqual(["RecordsApplied"]));
  });
});
