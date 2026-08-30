import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";

import {
  Cleanup,
  Connection,
  Domain,
  DomainKit,
  Lifecycle,
  Provisioning,
  Testing,
  Verification,
} from "../src/index.ts";

afterEach(cleanup);

const record: Transport.DnsRecord = {
  id: "dkim",
  name: "selector._domainkey.example.com",
  type: "TXT",
  value: "v=DKIM1; p=public-key",
};

const replacementRecord: Transport.DnsRecord = {
  id: "spf",
  name: "example.com",
  type: "TXT",
  value: "v=spf1 -all",
};

const connection = {
  _tag: "Connected" as const,
  connectionId: "connection-1",
  domain: "example.com",
  provider: Testing.provider(),
};

describe("provisioning lifecycle", () => {
  it("exposes a shared Atom model to custom provisioning UI", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const CustomProvisioning = () => {
      const model = Provisioning.useModel(connection, [record]);
      const state = useAtomValue(model.state);
      const command = useAtomSet(model.command);
      return (
        <>
          <span>{state._tag}</span>
          {state._tag === "Idle" ? (
            <button onClick={() => command(Provisioning.Command.Plan())}>Plan records</button>
          ) : null}
          {state._tag === "Review" ? (
            <button onClick={() => command(Provisioning.Command.Apply())}>Apply plan</button>
          ) : null}
        </>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <CustomProvisioning />
      </DomainKit.Root>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Plan records" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply plan" }));
    expect(await screen.findByText("Complete")).toBeTruthy();
    expect(transport.calls.apply).toHaveLength(1);
  });

  it("reviews exact operations and applies only the approved server digest", async () => {
    const user = userEvent.setup();
    const events: Array<Lifecycle.Event> = [];
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Review changes",
    });
    expect(within(dialog).getByText(/Create/)).toBeTruthy();
    expect(within(dialog).getByText(record.name)).toBeTruthy();
    expect(within(dialog).getByText(record.value)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Add records" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull(),
    );
    expect(screen.queryByText("DNS changes applied")).toBeNull();
    expect(transport.calls.apply).toEqual([
      {
        connectionId: "connection-1",
        domain: "example.com",
        planDigest: "plan-digest-1",
      },
    ]);
    expect(events.map((event) => event._tag)).toEqual(["RecordsApplied"]);
  });

  it("fails closed on conflicts", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      inspect: connection,
      plan: {
        _tag: "Plan",
        digest: "conflicting-plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [{ _tag: "Conflict", id: "conflict-1", reason: "TXT differs", record }],
      },
    });
    render(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/TXT differs/)).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Add records",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(transport.calls.apply).toEqual([]);
  });

  it("fails closed when custom UI dispatches Apply for a conflicting plan", async () => {
    const transport = Testing.makeFakeTransport({
      inspect: connection,
      plan: {
        _tag: "Plan",
        digest: "conflicting-plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [{ _tag: "Conflict", id: "conflict-1", reason: "TXT differs", record }],
      },
    });
    const CustomProvisioning = () => {
      const model = Provisioning.useModel(connection, [record]);
      const state = useAtomValue(model.state);
      const command = useAtomSet(model.command);
      return (
        <>
          <span>{state._tag}</span>
          <button onClick={() => command(Provisioning.Command.Plan())}>Plan records</button>
          <button onClick={() => command(Provisioning.Command.Apply())}>Apply plan</button>
        </>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <CustomProvisioning />
      </DomainKit.Root>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Plan records" }));
    expect(await screen.findByText("Review")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply plan" }));
    expect(screen.getByText("Review")).toBeTruthy();
    expect(transport.calls.apply).toEqual([]);
  });

  it("renders partial failure honestly and offers a durable host retry", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      apply: {
        _tag: "Partial",
        operationId: "apply-1",
        receiptId: "receipt-1",
        results: [
          {
            _tag: "Failed",
            message: "provider rejected record",
            operationId: "create-dkim",
          },
        ],
      },
      inspect: connection,
    });
    render(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(await screen.findByRole("button", { name: "Add records" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Some DNS changes failed");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(transport.calls.plan).toHaveLength(2);
  });

  it("ignores a pending plan after the requested records change", async () => {
    const pending = Promise.withResolvers<Transport.ProvisioningPlan>();
    const fake = Testing.makeFakeTransport({ inspect: connection });
    const transport = Transport.layerFromAsync({
      ...fake,
      provisioning: {
        ...fake.provisioning,
        plan: async (input) => {
          fake.calls.plan.push(input);
          return pending.promise;
        },
      },
    });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));

    rerender(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[replacementRecord]} />
      </DomainKit.Root>,
    );
    await act(async () => {
      pending.resolve({
        _tag: "Plan",
        digest: "stale-plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [{ _tag: "Create", id: "create-dkim", record }],
      });
      await pending.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeTruthy();
  });

  it("does not restore an obsolete plan after an identity cycle", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(await screen.findByRole("dialog", { name: "Review changes" })).toBeTruthy();

    rerender(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[replacementRecord]} />
      </DomainKit.Root>,
    );
    rerender(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull(),
    );
  });
});

describe("observation and cleanup", () => {
  it("exposes cleanup and verification Atom models to custom host UI", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const CustomLifecycle = () => {
      const cleanupModel = Cleanup.useModel(connection, "receipt-1");
      const cleanupState = useAtomValue(cleanupModel.state);
      const cleanupCommand = useAtomSet(cleanupModel.command);
      const verificationModel = Verification.useModel({
        connection,
        domain: connection.domain,
        records: [record],
      });
      const verificationState = useAtomValue(verificationModel.state);
      const verificationCommand = useAtomSet(verificationModel.command);
      return (
        <>
          <span>Cleanup {cleanupState._tag}</span>
          {cleanupState._tag === "Idle" ? (
            <button onClick={() => cleanupCommand(Cleanup.Command.Plan())}>Plan cleanup</button>
          ) : null}
          <span>Verification {verificationState._tag}</span>
          <button onClick={() => verificationCommand(Verification.Command.Observe())}>
            Observe records
          </button>
        </>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <CustomLifecycle />
      </DomainKit.Root>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Plan cleanup" }));
    expect(await screen.findByText("Cleanup Review")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Observe records" }));
    expect(await screen.findByText("Verification Observation")).toBeTruthy();
    expect(transport.calls.cleanupPlan).toHaveLength(1);
    expect(transport.calls.observe).toHaveLength(1);
  });

  it("does not revive an applied receipt after the host receipt cycles", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" receiptId="receipt-a" records={[record]} />
      </DomainKit.Root>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add records" }));
    await waitFor(() => expect(transport.calls.apply).toHaveLength(1));
    rerender(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" receiptId="receipt-b" records={[record]} />
      </DomainKit.Root>,
    );
    rerender(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" receiptId="receipt-a" records={[record]} />
      </DomainKit.Root>,
    );

    fireEvent.click(screen.getByRole("menuitem", { hidden: true, name: "Remove records" }));
    await waitFor(() => expect(transport.calls.cleanupPlan).toHaveLength(1));
    expect(transport.calls.cleanupPlan[0]?.receiptId).toBe("receipt-a");
    rerender(<></>);
  });

  it("keeps the applied receipt available for cleanup when requested records change", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" receiptId="host-receipt" records={[record]} />
      </DomainKit.Root>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add records" }));
    await waitFor(() => expect(transport.calls.apply).toHaveLength(1));
    rerender(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" receiptId="host-receipt" records={[replacementRecord]} />
      </DomainKit.Root>,
    );

    fireEvent.click(screen.getByRole("menuitem", { hidden: true, name: "Remove records" }));
    await waitFor(() => expect(transport.calls.cleanupPlan).toHaveLength(1));
    expect(transport.calls.cleanupPlan[0]?.receiptId).toBe("receipt-1");
    rerender(<></>);
  });

  it("keeps a locally applied receipt when no host receipt exists", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" records={[record]} />
      </DomainKit.Root>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add records" }));
    await waitFor(() => expect(transport.calls.apply).toHaveLength(1));
    rerender(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" records={[replacementRecord]} />
      </DomainKit.Root>,
    );

    fireEvent.click(screen.getByRole("menuitem", { hidden: true, name: "Remove records" }));
    await waitFor(() => expect(transport.calls.cleanupPlan).toHaveLength(1));
    expect(transport.calls.cleanupPlan[0]?.receiptId).toBe("receipt-1");
    rerender(<></>);
  });

  it("uses one observe operation with explicit provider and public DNS sources", async () => {
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const VerificationHarness = () => {
      const controller = Verification.useController({
        connection,
        domain: "example.com",
        records: [record],
      });
      return <button onClick={() => controller.observe()}>Check DNS</button>;
    };
    render(
      <DomainKit.Root transport={transport}>
        <VerificationHarness />
      </DomainKit.Root>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check DNS" }));
    await waitFor(() =>
      expect(transport.calls.observe).toEqual([
        {
          connectionId: "connection-1",
          domain: "example.com",
          records: [record],
          sources: { provider: true, publicDns: true },
        },
      ]),
    );
  });

  it("blocks unproven cleanup while domain disconnect preserves DNS", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      cleanupPlan: {
        _tag: "CleanupPlan",
        digest: "cleanup-digest",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [
          {
            _tag: "Blocked",
            id: "blocked-1",
            reason: "record drifted",
            record,
          },
        ],
      },
      inspect: connection,
      removeDomain: {
        _tag: "Removed",
        connectionId: "connection-1",
        domain: "example.com",
        remainingDomainCount: 1,
      },
    });
    render(
      <DomainKit.Root transport={transport}>
        <Cleanup.Flow connection={connection} receiptId="receipt-1" />
        <Connection.DisconnectDialog
          connection={connection}
          controller={{
            connect: () => undefined,
            disconnect: () => {
              void transport.connection.removeDomain({
                connectionId: connection.connectionId,
                domain: connection.domain,
                preserveDns: true,
              });
            },
            retry: () => undefined,
            reuse: () => undefined,
            state: connection,
          }}
        />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Remove records" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(record.name)).toBeTruthy();
    expect(within(dialog).getByText(record.value)).toBeTruthy();
    expect(within(dialog).getByText(/record drifted/)).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Remove records",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );

    await waitFor(() => expect(transport.calls.removeDomain).toHaveLength(1));
    expect(transport.calls.removeDomain[0]).toEqual({
      connectionId: "connection-1",
      domain: "example.com",
      preserveDns: true,
    });
    expect(transport.calls.cleanupApply).toEqual([]);
  });

  it("closes successful cleanup and delegates feedback to lifecycle events", async () => {
    const user = userEvent.setup();
    const events: Array<Lifecycle.Event> = [];
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Cleanup.Flow connection={connection} receiptId="receipt-1" />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Remove records" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Remove records",
    });
    await user.click(within(dialog).getByRole("button", { name: "Remove records" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Remove records" })).toBeNull(),
    );
    expect(screen.queryByText("DNS cleanup complete")).toBeNull();
    expect(events.map((event) => event._tag)).toEqual(["RecordsCleaned"]);
  });

  it("ignores a pending cleanup plan after the receipt changes", async () => {
    const pending = Promise.withResolvers<Transport.CleanupPlan>();
    const fake = Testing.makeFakeTransport({ inspect: connection });
    const transport = Transport.layerFromAsync({
      ...fake,
      cleanup: {
        ...fake.cleanup,
        plan: async (input) => {
          fake.calls.cleanupPlan.push(input);
          return pending.promise;
        },
      },
    });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Cleanup.Flow connection={connection} receiptId="receipt-1" />
      </DomainKit.Root>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove records" }));

    rerender(
      <DomainKit.Root transport={transport}>
        <Cleanup.Flow connection={connection} receiptId="receipt-2" />
      </DomainKit.Root>,
    );
    await act(async () => {
      pending.resolve({
        _tag: "CleanupPlan",
        digest: "stale-cleanup",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [{ _tag: "Delete", id: "delete-dkim", record }],
      });
      await pending.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Remove records" })).toBeNull();
    expect(fake.calls.cleanupPlan[0]?.receiptId).toBe("receipt-1");
  });

  it("keeps disconnect available without a receipt and hides remove records", async () => {
    const events: Array<Lifecycle.Event> = [];
    const transport = Testing.makeFakeTransport({
      inspect: connection,
      removeDomain: {
        _tag: "Removed",
        connectionId: connection.connectionId,
        domain: connection.domain,
        remainingDomainCount: 1,
      },
    });
    render(
      <DomainKit.Root onEvent={(event) => events.push(event)} transport={transport}>
        <Domain.Flow domain="example.com" records={[record]} />
      </DomainKit.Root>,
    );

    await screen.findByRole("button", { name: "More connection actions" });
    const disconnect = screen.getByRole("menuitem", {
      hidden: true,
      name: "Disconnect",
    });
    expect(screen.queryByRole("menuitem", { hidden: true, name: "Remove records" })).toBeNull();
    await act(async () => {
      disconnect.click();
      await Promise.resolve();
    });
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );

    expect(await screen.findByText("Cloudflare manages DNS for this domain")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "Cloudflare" })).toHaveLength(1);
    expect(screen.queryByText("Cloudflare connected")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(events.map((event) => event._tag)).toEqual(["DomainDisconnected"]);
  });

  it("fails closed when custom UI dispatches Apply for a blocked cleanup plan", async () => {
    const transport = Testing.makeFakeTransport({
      cleanupPlan: {
        _tag: "CleanupPlan",
        digest: "cleanup-digest",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [
          {
            _tag: "Blocked",
            id: "blocked-1",
            reason: "record drifted",
            record,
          },
        ],
      },
      inspect: connection,
    });
    const CustomCleanup = () => {
      const model = Cleanup.useModel(connection, "receipt-1");
      const state = useAtomValue(model.state);
      const command = useAtomSet(model.command);
      return (
        <>
          <span>{state._tag}</span>
          <button onClick={() => command(Cleanup.Command.Plan())}>Plan cleanup</button>
          <button onClick={() => command(Cleanup.Command.Apply())}>Apply cleanup</button>
        </>
      );
    };
    render(
      <DomainKit.Root transport={transport}>
        <CustomCleanup />
      </DomainKit.Root>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Plan cleanup" }));
    expect(await screen.findByText("Review")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply cleanup" }));
    expect(screen.getByText("Review")).toBeTruthy();
    expect(transport.calls.cleanupApply).toEqual([]);
  });
});
