/** The registry of provider definitions a host enabled. Built by `DomainKit.layer`. */
import { Context, Effect, Layer } from "effect";

import * as DomainKitError from "./DomainKitError.ts";
import * as Provider from "./Provider.ts";

export interface Service {
  readonly get: (id: string) => Effect.Effect<Provider.Definition, DomainKitError.DomainKitError>;
  readonly list: () => ReadonlyArray<Provider.Definition>;
  /** For UI catalogs: which methods each provider offers. */
  readonly methods: (
    id: string,
  ) => Effect.Effect<ReadonlyArray<Provider.AuthMethod>, DomainKitError.DomainKitError>;
}

export class Providers extends Context.Service<Providers, Service>()("@domainkit/Providers") {}

export const make = (definitions: ReadonlyArray<Provider.Definition>): Service => {
  const byId = new Map<string, Provider.Definition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new DomainKitError.DomainKitError({
        reason: new DomainKitError.InvalidInput({
          message: `Provider ${definition.id} is registered twice`,
          field: "providers",
        }),
      });
    }
    byId.set(definition.id, definition);
  }
  const get: Service["get"] = (id) =>
    Effect.suspend(() => {
      const definition = byId.get(id);
      return definition === undefined
        ? DomainKitError.fail(new DomainKitError.NotFound({ entity: "provider", id }))
        : Effect.succeed(definition);
    });
  return {
    get,
    list: () => [...byId.values()],
    methods: (id) => Effect.map(get(id), Provider.methods),
  };
};

export const layer = (definitions: ReadonlyArray<Provider.Definition>): Layer.Layer<Providers> =>
  Layer.sync(Providers)(() => make(definitions));
