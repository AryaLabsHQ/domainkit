import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import type * as Atom from "effect/unstable/reactivity/Atom";
import { Transport } from "domainkit";

export type Runtime = Atom.AtomRuntime<Transport.Service>;

export interface Failure {
  readonly _tag: "Failure";
  readonly message: string;
  readonly operation: string;
  readonly retry: Transport.Failure["retry"];
}

export const failureFromCause = (
  cause: Cause.Cause<Transport.Failure>,
  operation: string,
  fallbackMessage: string,
): Failure => {
  const error = Cause.findErrorOption(cause);
  return Option.isSome(error)
    ? {
        _tag: "Failure",
        message: error.value.message,
        operation: error.value.operation,
        retry: error.value.retry,
      }
    : {
        _tag: "Failure",
        message: fallbackMessage,
        operation,
        retry: "safe",
      };
};

export const recordsIdentity = (records: ReadonlyArray<Transport.DnsRecord>): string =>
  JSON.stringify(
    records.map(({ id, name, priority, type, value }) => ({ id, name, priority, type, value })),
  );
