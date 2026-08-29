import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Cleanup,
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

    await user.click(screen.getByRole("button", { name: "Review DNS changes" }));
    const dialog = await screen.findByRole("dialog", { name: "Review DNS changes" });
    expect(within(dialog).getByText(/Create/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Apply DNS changes" }));

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

    await user.click(screen.getByRole("button", { name: "Review DNS changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/TXT differs/)).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Apply DNS changes" }) as HTMLButtonElement)
        .disabled,
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

    await user.click(screen.getByRole("button", { name: "Review DNS changes" }));
    await user.click(await screen.findByRole("button", { name: "Apply DNS changes" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Some DNS changes failed");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(transport.calls.plan).toHaveLength(2);
  });
});

describe("observation and cleanup", () => {
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
        remainingDomains: ["other.example.com"],
      },
    });
    render(
      <DomainKit.Root transport={transport}>
        <Cleanup.Flow connection={connection} receiptId="receipt-1" />
      </DomainKit.Root>,
    );

    await user.click(screen.getByRole("button", { name: "Review DNS cleanup" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/record drifted/)).toBeTruthy();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Delete these DNS records",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Disconnect domain and keep DNS" }));

    await waitFor(() => expect(transport.calls.removeDomain).toHaveLength(1));
    expect(transport.calls.removeDomain[0]).toEqual({
      connectionId: "connection-1",
      domain: "example.com",
      preserveDns: true,
    });
    expect(transport.calls.cleanupApply).toEqual([]);
    expect(await screen.findByText(/DNS records were preserved/)).toBeTruthy();
  });
});
