import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Cleanup,
  Connection,
  Domain,
  DomainKit,
  Provisioning,
  Testing,
  Verification,
  type Transport,
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
  it("reviews exact operations and applies only the approved server digest", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root transport={transport}>
        <Provisioning.Flow connection={connection} records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review changes" });
    expect(within(dialog).getByText(/Create/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Add records" }));

    expect(await screen.findByText("DNS changes applied")).toBeTruthy();
    expect(transport.calls.apply).toEqual([
      { connectionId: "connection-1", domain: "example.com", planDigest: "plan-digest-1" },
    ]);
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
      (within(dialog).getByRole("button", { name: "Add records" }) as HTMLButtonElement).disabled,
    ).toBe(true);
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
          { _tag: "Failed", message: "provider rejected record", operationId: "create-dkim" },
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
    const pending = Promise.withResolvers<Transport.ProvisioningPlan | Transport.Failure>();
    const fake = Testing.makeFakeTransport({ inspect: connection });
    const transport: Transport.DomainKitTransport = {
      ...fake,
      provisioning: {
        ...fake.provisioning,
        plan: async (input) => {
          fake.calls.plan.push(input);
          return pending.promise;
        },
      },
    };
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
  it("does not revive an applied receipt after the host receipt cycles", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: connection });
    const { rerender } = render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" receiptId="receipt-a" records={[record]} />
      </DomainKit.Root>,
    );

    await user.click(await screen.findByRole("button", { name: "Review changes" }));
    await user.click(await screen.findByRole("button", { name: "Add records" }));
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

    await user.click(screen.getByRole("button", { name: "Remove records" }));
    await waitFor(() => expect(transport.calls.cleanupPlan).toHaveLength(1));
    expect(transport.calls.cleanupPlan[0]?.receiptId).toBe("receipt-a");
  });

  it("uses one observe operation with explicit provider and public DNS sources", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root transport={transport}>
        <Verification.Status config={{ connection, domain: "example.com", records: [record] }} />
      </DomainKit.Root>,
    );
    await user.click(screen.getByRole("button", { name: "Check DNS" }));
    expect(await screen.findAllByText(/dkim: Found/)).toHaveLength(2);
    expect(transport.calls.observe).toEqual([
      {
        connectionId: "connection-1",
        domain: "example.com",
        records: [record],
        sources: { provider: true, publicDns: true },
      },
    ]);
  });

  it("blocks unproven cleanup while domain disconnect preserves DNS", async () => {
    const user = userEvent.setup();
    const transport = Testing.makeFakeTransport({
      cleanupPlan: {
        _tag: "CleanupPlan",
        digest: "cleanup-digest",
        expiresAt: "2099-01-01T00:00:00.000Z",
        operations: [{ _tag: "Blocked", id: "blocked-1", reason: "record drifted", record }],
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
        <Connection.DisconnectAction connection={connection} />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Remove records" }));
    const dialog = await screen.findByRole("dialog");
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

    await waitFor(() => expect(transport.calls.removeDomain).toHaveLength(1));
    expect(transport.calls.removeDomain[0]).toEqual({
      connectionId: "connection-1",
      domain: "example.com",
      preserveDns: true,
    });
    expect(transport.calls.cleanupApply).toEqual([]);
    expect(await screen.findByText(/DNS records were preserved/)).toBeTruthy();
  });

  it("ignores a pending cleanup plan after the receipt changes", async () => {
    const pending = Promise.withResolvers<Transport.CleanupPlan | Transport.Failure>();
    const fake = Testing.makeFakeTransport({ inspect: connection });
    const transport: Transport.DomainKitTransport = {
      ...fake,
      cleanup: {
        ...fake.cleanup,
        plan: async (input) => {
          fake.calls.cleanupPlan.push(input);
          return pending.promise;
        },
      },
    };
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
    const transport = Testing.makeFakeTransport({ inspect: connection });
    render(
      <DomainKit.Root transport={transport}>
        <Domain.Flow domain="example.com" records={[record]} />
      </DomainKit.Root>,
    );

    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove records" })).toBeNull();
  });
});
