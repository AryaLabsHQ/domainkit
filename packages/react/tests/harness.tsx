import { act, renderHook, waitFor, type RenderHookResult } from "@testing-library/react";
import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";
import type { ReactNode } from "react";

import { DomainKit, Testing } from "../src/index.ts";

/**
 * A plan crosses a real in-memory server, custody key and all. Under the runner's parallel files
 * that is not a millisecond job, so the waits get the room the file's own timeout already allows
 * rather than the query default of a second.
 */
export const patient = { timeout: 20_000 } as const;

export interface Scenario {
  readonly domain: string;
  readonly sibling: string;
  readonly zone: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly transport: Testing.RecordingTransport;
}

export interface ScenarioOptions {
  readonly capabilities?: ReadonlyArray<Transport.Capability>;
  readonly provider?: Testing.TransportOptions["provider"];
}

/**
 * Every fake provider registers its zones in one process-wide table, so each case takes a zone of
 * its own and neither the resolver nor discovery sees another case's records.
 */
let cases = 0;
export const scenario = (options: ScenarioOptions = {}): Scenario => {
  const zone = `case${(cases += 1)}.example`;
  const domain = `app.${zone}`;
  return {
    domain,
    requirements: [
      DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
      DnsRecord.txt({
        name: `_acme.${domain}`,
        purpose: "Prove ownership",
        value: "acme-verify=7f3a",
      }),
    ],
    sibling: `mail.${zone}`,
    transport: Testing.transport({
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      // The zone's nameservers are the fake's own, so discovery names it as the host.
      provider: { nameserverSuffixes: [zone], zones: [zone], ...options.provider },
    }),
    zone,
  };
};

export interface MountOptions {
  readonly readOnly?: boolean;
  readonly navigate?: (url: string) => void;
  readonly revision?: number;
}

/** `DomainKit.Root` over one transport, as a `renderHook` wrapper. */
export const wrap = (transport: Transport.Interface, options: MountOptions = {}) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <DomainKit.Root transport={transport} {...options}>
        {children}
      </DomainKit.Root>
    );
  };

/** Render one hook inside `DomainKit.Root`, which is how every hook here is meant to be called. */
export const mount = <Props, Value>(
  transport: Transport.Interface,
  hook: (props: Props) => Value,
  options: MountOptions & { readonly initialProps?: Props } = {},
): RenderHookResult<Value, Props> => {
  const { initialProps, ...root } = options;
  return renderHook<Value, Props>(hook, {
    ...(initialProps === undefined ? {} : { initialProps }),
    wrapper: wrap(transport, root),
  } as Parameters<typeof renderHook<Value, Props>>[1]);
};

/** Which methods the transport was asked for, in the order it was asked. */
export const methodsCalled = (transport: Testing.RecordingTransport): ReadonlyArray<string> =>
  transport.calls.map((call) => call.method);

/** Run a controller command from a test, which is a React update like any other. */
export const run = async (command: () => void): Promise<void> => {
  await act(async () => {
    command();
  });
};

/** Wait for a value the render loop produces, with the room a real server call needs. */
export const until = <A,>(assertion: () => A): Promise<A> => waitFor(assertion, patient);

/** Connect a domain with the fake provider's token method, over the transport rather than a UI. */
export const attach = async (
  transport: Testing.RecordingTransport,
  domain?: string,
): Promise<void> => {
  const connection = transport.connection;
  if (connection === undefined) throw new Error("The fake transport has no connection group");
  await Effect.runPromise(
    connection.start({
      ...(domain === undefined ? {} : { domain }),
      method: Transport.Method.token({ token: "tok" }),
      provider: "fake",
    }),
  );
};
