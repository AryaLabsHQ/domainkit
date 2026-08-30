import type {
  Connected,
  ConnectionResult,
  ConnectionSnapshot,
  DomainKitTransport,
  ApplyResult,
  CleanupPlan,
  CleanupResult,
  Observation,
  Provider,
  ProvisioningPlan,
  RemoveDomainResult,
} from "./transport.ts";

export interface FakeOptions {
  readonly connect?: ConnectionResult;
  readonly inspect: ConnectionSnapshot | ReadonlyArray<ConnectionSnapshot>;
  readonly reuse?: Connected;
  readonly removeDomain?: RemoveDomainResult;
  readonly plan?: ProvisioningPlan;
  readonly apply?: ApplyResult;
  readonly observe?: Observation;
  readonly cleanupPlan?: CleanupPlan;
  readonly cleanupApply?: CleanupResult;
}

export interface FakeTransport extends DomainKitTransport {
  readonly calls: {
    readonly connect: Array<Parameters<DomainKitTransport["connection"]["connect"]>[0]>;
    readonly inspect: Array<Parameters<DomainKitTransport["connection"]["inspect"]>[0]>;
    readonly reuse: Array<Parameters<DomainKitTransport["connection"]["reuse"]>[0]>;
    readonly removeDomain: Array<Parameters<DomainKitTransport["connection"]["removeDomain"]>[0]>;
    readonly plan: Array<Parameters<DomainKitTransport["provisioning"]["plan"]>[0]>;
    readonly apply: Array<Parameters<DomainKitTransport["provisioning"]["apply"]>[0]>;
    readonly observe: Array<Parameters<DomainKitTransport["verification"]["observe"]>[0]>;
    readonly cleanupPlan: Array<Parameters<DomainKitTransport["cleanup"]["plan"]>[0]>;
    readonly cleanupApply: Array<Parameters<DomainKitTransport["cleanup"]["apply"]>[0]>;
  };
}

export const provider = (overrides: Partial<Provider> = {}): Provider => ({
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
  return {
    calls,
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
        return inspections.shift() ?? inspections.at(-1) ?? options.inspect;
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
}
