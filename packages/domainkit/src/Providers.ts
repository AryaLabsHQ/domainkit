/** The registry of provider definitions a host enabled. Built by `DomainKit.layer`. */
import { Context, Effect, Layer } from "effect";

import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as Provider from "./Provider.ts";

export interface Interface {
  readonly get: (id: string) => Effect.Effect<Provider.Definition, Errors.DomainKitError>;
  readonly list: () => ReadonlyArray<Provider.Definition>;
  /** For UI catalogs: which methods each provider offers. */
  readonly methods: (
    id: string,
  ) => Effect.Effect<ReadonlyArray<Provider.AuthMethod>, Errors.DomainKitError>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Providers") {}

export const make = (definitions: ReadonlyArray<Provider.Definition>): Interface => {
  const byId = new Map<string, Provider.Definition>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Errors.DomainKitError({
        reason: new Reason.InvalidInput({
          message: `Provider ${definition.id} is registered twice`,
          field: "providers",
        }),
      });
    }
    byId.set(definition.id, definition);
  }
  const get: Interface["get"] = (id) =>
    Effect.suspend(() => {
      const definition = byId.get(id);
      return definition === undefined
        ? Errors.fail(new Reason.NotFound({ entity: "provider", id }))
        : Effect.succeed(definition);
    });
  return {
    get,
    list: () => [...byId.values()],
    methods: (id) => Effect.map(get(id), Provider.methods),
  };
};

export const layer = (definitions: ReadonlyArray<Provider.Definition>): Layer.Layer<Service> =>
  Layer.sync(Service)(() => make(definitions));
