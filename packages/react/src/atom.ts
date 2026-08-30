import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import type * as Atom from "effect/unstable/reactivity/Atom";
import { Transport } from "domainkit";

export type Runtime = Atom.AtomRuntime<Transport.Service>;

export const failureFromCause = (
  cause: Cause.Cause<Transport.Failure>,
  operation: string,
  fallbackMessage: string,
): Transport.Failure =>
  Option.getOrElse(
    Cause.findErrorOption(cause),
    () =>
      new Transport.Failure({
        message: fallbackMessage,
        operation,
        retry: "safe",
      }),
  );

export const recordsIdentity = (records: ReadonlyArray<Transport.DnsRecord>): string =>
  JSON.stringify(
    records.map(({ id, name, priority, type, value }) => ({ id, name, priority, type, value })),
  );
