import { Transport } from "domainkit";
import type * as Layer from "effect/Layer";

export interface FakeOptions {
  readonly connect?: Transport.ConnectionResult;
  readonly inspect:
    | Transport.ConnectionSnapshot
    | FakeFailure
    | ReadonlyArray<Transport.ConnectionSnapshot | FakeFailure>;
  readonly reuse?: Transport.Connected;
  readonly removeDomain?: Transport.RemoveDomainResult;
  readonly plan?: Transport.ProvisioningPlan;
  readonly apply?: Transport.ApplyResult;
  readonly observe?: Transport.Observation;
  readonly cleanupPlan?: Transport.CleanupPlan;
  readonly cleanupApply?: Transport.CleanupResult;
}

interface FakeFailure {
  readonly _tag: "Failure";
  readonly message: string;
  readonly operation?: string;
  readonly retry: Transport.Failure["retry"];
}

export interface FakeTransport extends Transport.AsyncInterface, Layer.Layer<Transport.Service> {
  readonly calls: {
    readonly connect: Array<Transport.ConnectInput>;
    readonly inspect: Array<Transport.InspectInput>;
    readonly reuse: Array<Transport.ReuseInput>;
    readonly removeDomain: Array<Transport.RemoveDomainInput>;
    readonly plan: Array<Transport.ProvisioningPlanInput>;
    readonly apply: Array<Transport.ProvisioningApplyInput>;
    readonly observe: Array<Transport.ObserveInput>;
    readonly cleanupPlan: Array<Transport.CleanupPlanInput>;
    readonly cleanupApply: Array<Transport.CleanupApplyInput>;
  };
}

export const provider = (overrides: Partial<Transport.Provider> = {}): Transport.Provider => ({
  authentication: [
    { _tag: "OAuth", label: "Continue with OAuth" },
    { _tag: "Token", label: "Connect with token", placeholder: "Paste API token" },
  ],
  id: "cloudflare",
  name: "Cloudflare",
  ...overrides,
});

export function makeFakeTransport(options: FakeOptions): FakeTransport {
  const calls: FakeTransport["calls"] = {
    apply: [],
    cleanupApply: [],
    cleanupPlan: [],
    connect: [],
    inspect: [],
    observe: [],
    plan: [],
    removeDomain: [],
    reuse: [],
  };
  const inspections = Array.isArray(options.inspect) ? [...options.inspect] : [options.inspect];
  const transport: Transport.AsyncInterface = {
    cleanup: {
      apply: async (input) => {
        calls.cleanupApply.push(input);
        return (
          options.cleanupApply ?? {
            _tag: "Cleaned",
            operationId: "cleanup-operation-1",
            results: [],
          }
        );
      },
      plan: async (input) => {
        calls.cleanupPlan.push(input);
        return (
          options.cleanupPlan ?? {
            _tag: "CleanupPlan",
            digest: "cleanup-digest-1",
            expiresAt: "2099-01-01T00:00:00.000Z",
            operations: [],
          }
        );
      },
    },
    connection: {
      connect: async (input) => {
        calls.connect.push(input);
        return (
          options.connect ?? {
            _tag: "Connected",
            connectionId: "connection-1",
            domain: input.domain,
            provider: provider(),
          }
        );
      },
      inspect: async (input) => {
        calls.inspect.push(input);
        const snapshot = inspections.shift() ?? inspections.at(-1) ?? options.inspect;
        if (Array.isArray(snapshot)) throw new Error("Fake inspection sequence is empty");
        if (snapshot._tag === "Failure")
          throw new Transport.Failure({
            message: snapshot.message,
            operation: snapshot.operation ?? "connection.inspect",
            retry: snapshot.retry,
          });
        return snapshot;
      },
      reuse: async (input) => {
        calls.reuse.push(input);
        return (
          options.reuse ?? {
            _tag: "Connected",
            connectionId: input.connectionId,
            domain: input.domain,
            provider: provider(),
          }
        );
      },
      removeDomain: async (input) => {
        calls.removeDomain.push(input);
        return (
          options.removeDomain ?? {
            _tag: "Removed",
            connectionId: input.connectionId,
            domain: input.domain,
            remainingDomainCount: 0,
          }
        );
      },
    },
    provisioning: {
      apply: async (input) => {
        calls.apply.push(input);
        return (
          options.apply ?? {
            _tag: "Applied",
            operationId: "apply-operation-1",
            receiptId: "receipt-1",
            results: [],
          }
        );
      },
      plan: async (input) => {
        calls.plan.push(input);
        return (
          options.plan ?? {
            _tag: "Plan",
            digest: "plan-digest-1",
            expiresAt: "2099-01-01T00:00:00.000Z",
            operations: input.records.map((record) => ({
              _tag: "Create" as const,
              id: `create-${record.id}`,
              record,
            })),
          }
        );
      },
    },
    verification: {
      observe: async (input) => {
        calls.observe.push(input);
        return (
          options.observe ?? {
            _tag: "Observation",
            provider: input.sources.provider
              ? input.records.map((record) => ({ _tag: "Found" as const, recordId: record.id }))
              : [],
            publicDns: input.sources.publicDns
              ? input.records.map((record) => ({ _tag: "Found" as const, recordId: record.id }))
              : [],
          }
        );
      },
    },
  };
  return Object.assign(Transport.layerFromAsync(transport), transport, { calls });
}
