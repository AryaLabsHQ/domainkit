import * as Data from "effect/Data";
import type * as Atom from "effect/unstable/reactivity/Atom";
import { Transport } from "domainkit";

export type Runtime = Atom.AtomRuntime<Transport.Service>;

export type Failure = Data.TaggedEnum<{
  Failure: {
    readonly message: string;
    readonly operation: string;
    readonly retry: Transport.Failure["retry"];
  };
}>;
export const Failure = Data.taggedEnum<Failure>();

export const failureFromError = (error: Transport.Failure): Failure =>
  Failure.Failure({
    message: error.message,
    operation: error.operation,
    retry: error.retry,
  });

export const failureFromDefect = (operation: string, message: string): Failure =>
  Failure.Failure({ message, operation, retry: "safe" });

export const recordsIdentity = (records: ReadonlyArray<Transport.DnsRecord>): string =>
  JSON.stringify(
    records.map(({ id, name, priority, type, value }) => ({ id, name, priority, type, value })),
  );
