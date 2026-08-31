import { Context, Effect, Schema } from "effect";

export class Error extends Schema.TaggedError<Error>()("HostBindingError", {
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export interface OwnerReference {
  readonly ownerReference: string;
}

export interface DomainReference extends OwnerReference {
  readonly domainReference: string;
}

export interface Interface {
  /** Resolve a durable host owner reference without capturing request identity. */
  readonly owner: (ownerId: string) => Effect.Effect<OwnerReference, Error>;
  /** Resolve a host domain reference inside the caller's active transaction context. */
  readonly domain: (input: {
    readonly domain: string;
    readonly ownerId: string;
  }) => Effect.Effect<DomainReference, Error>;
  /** Project an opaque stored owner reference back to DomainKit's semantic owner id. */
  readonly ownerId: (ownerReference: string) => Effect.Effect<string, Error>;
}

/** Stateless host mapping for tenant/domain foreign-key references. */
export class Service extends Context.Service<Service, Interface>()(
  "@domainkit/capsuledb/HostBindings",
) {}
