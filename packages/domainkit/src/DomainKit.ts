/**
 * The composed layer. Provides every lifecycle service given a list of providers; the host
 * provides `Storage` and `Custody` beneath it, the same way `Persistence.layer` sits over a
 * backing store in Effect.
 *
 * Defaults: `Resolver.layer` (Cloudflare + Google DoH) and the `Policy` references. Override a
 * policy with `Effect.provideService`; pass `resolver` for a different pool.
 */
import { Layer, Redacted } from "effect";

import * as Cleanup from "./Cleanup.ts";
import * as Connect from "./Connect.ts";
import * as Custody from "./Custody.ts";
import { DomainKitError } from "./internal/error.ts";
import type * as Provider from "./Provider.ts";
import * as Providers from "./Providers.ts";
import * as Provision from "./Provision.ts";
import * as Resolver from "./Resolver.ts";
import * as Storage from "./Storage.ts";
import * as Verify from "./Verify.ts";

export { DomainKitError as Error };
export type { Category as ErrorCategory } from "./internal/error.ts";

export const isError = (input: unknown): input is DomainKitError => input instanceof DomainKitError;

export interface Options {
  readonly providers: ReadonlyArray<Provider.Definition>;
  /** Replace the public DNS pool (e.g. `Testing.resolver()`); default `Resolver.layer`. */
  readonly resolver?: Layer.Layer<Resolver.Service>;
}

export type Services =
  | Provision.Service
  | Cleanup.Service
  | Connect.Service
  | Verify.Service
  | Providers.Service
  | Resolver.Service;

export const layer = (
  options: Options,
): Layer.Layer<Services, never, Storage.Service | Custody.Service> =>
  Layer.mergeAll(Provision.layer, Cleanup.layer, Verify.layer).pipe(
    Layer.provideMerge(Connect.layer),
    Layer.provideMerge(
      Layer.mergeAll(Providers.layer(options.providers), options.resolver ?? Resolver.layer),
    ),
  );

/** `layer` with `Storage.layerMemory` and a throwaway custody key. Tests and playgrounds only. */
export const layerMemory = (
  options: Options,
): Layer.Layer<Services | Storage.Service | Custody.Service, DomainKitError> =>
  layer(options).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Storage.layerMemory,
        Custody.layer({ key: Redacted.make(Custody.generateKey()) }),
      ),
    ),
  );
