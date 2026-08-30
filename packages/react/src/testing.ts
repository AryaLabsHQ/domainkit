import type {
  Connected,
  ConnectionResult,
  ConnectionSnapshot,
  DomainKitTransport,
  Provider,
} from "./transport.ts";

export interface FakeOptions {
  readonly connect?: ConnectionResult;
  readonly inspect: ConnectionSnapshot | ReadonlyArray<ConnectionSnapshot>;
  readonly reuse?: Connected;
}

export interface FakeTransport extends DomainKitTransport {
  readonly calls: {
    readonly connect: Array<Parameters<DomainKitTransport["connection"]["connect"]>[0]>;
    readonly inspect: Array<Parameters<DomainKitTransport["connection"]["inspect"]>[0]>;
    readonly reuse: Array<Parameters<DomainKitTransport["connection"]["reuse"]>[0]>;
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
  const calls: FakeTransport["calls"] = { connect: [], inspect: [], reuse: [] };
  const inspections = Array.isArray(options.inspect) ? [...options.inspect] : [options.inspect];
  return {
    calls,
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
    },
  };
}
