import { Effect, type Layer, Redacted } from "effect";
import type { Provider, Storage } from "domainkit";
import { Testing } from "domainkit/testing";

// #region storage
/**
 * Register every `Storage` invariant with your test runner: tenant isolation, apply leases,
 * exactly-once continuations, revocation recovery, and lock semantics. Both shipped
 * implementations pass this suite, so a host can swap them without a behaviour change.
 */
export const registerStorageCases = (
  layer: Layer.Layer<Storage.Service, unknown>,
  it: (name: string, run: () => Promise<void>) => void,
) => Testing.conformance.storage(layer, { it });
// #endregion storage

// #region provider
/**
 * A provider author runs this against a real account before shipping: create and read back, exact
 * no-op, conflict, stale plan, and partial apply, all through the same services hosts use. Every
 * record it creates carries the prefix and is removed again.
 */
export const check = (definition: Provider.Definition, token: string, zone: string) =>
  Testing.conformance.provider(
    definition,
    { secret: Redacted.make(token), context: { apiKey: token } },
    zone,
    { prefix: "acme-conformance" },
  );

export const run = (definition: Provider.Definition, token: string) =>
  Effect.runPromise(check(definition, token, "example.com"));
// #endregion provider
