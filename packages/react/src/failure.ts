import type { DomainKit } from "domainkit";
import * as Data from "effect/Data";

/**
 * The failed member every controller state shares. It carries the `DomainKit.Error` itself, so a
 * host reads `error.reason`, `error.category`, and `error.isRetryable` instead of parsing text.
 */
export type Failure = Data.TaggedEnum<{
  Failure: { readonly error: DomainKit.Error };
}>;
export const Failure = Data.taggedEnum<Failure>();

/** A defect that escaped the transport, in the shape the rest of the UI already handles. */
export const isFailure = (state: { readonly _tag: string }): state is Failure =>
  state._tag === "Failure";
