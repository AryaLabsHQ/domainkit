/**
 * The composed layer. Provides every lifecycle service given a list of providers; the host
 * provides `Storage` and `Custody` beneath it, the same way `Persistence.layer` sits over a
 * backing store in Effect.
 *
 * Defaults: `Resolver.layer` (Cloudflare + Google DoH), WebCrypto digests, and the `Policy`
 * references. Override a policy with `Effect.provideService`; pass `resolver` for a different pool.
 */
import { Layer, Redacted } from "effect";

import * as Cleanup from "./Cleanup.ts";
import * as Connect from "./Connect.ts";
import * as Custody from "./Custody.ts";
import type * as DomainKitError from "./DomainKitError.ts";
import type * as Provider from "./Provider.ts";
import * as Providers from "./Providers.ts";
import * as Provision from "./Provision.ts";
import * as Storage from "./Storage.ts";

export interface Options {
  readonly providers: ReadonlyArray<Provider.Definition>;
}

export type Services =
  | Provision.Provision
  | Cleanup.Cleanup
  | Connect.Connect
  | Providers.Providers;

export const layer = (
  options: Options,
): Layer.Layer<Services, never, Storage.Storage | Custody.Custody> =>
  Layer.mergeAll(Provision.layer, Cleanup.layer).pipe(
    Layer.provideMerge(Connect.layer),
    Layer.provideMerge(Providers.layer(options.providers)),
  );

/** `layer` with `Storage.layerMemory` and a throwaway custody key. Tests and playgrounds only. */
export const layerMemory = (
  options: Options,
): Layer.Layer<Services | Storage.Storage | Custody.Custody, DomainKitError.DomainKitError> =>
  layer(options).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Storage.layerMemory,
        Custody.layer({ key: Redacted.make(Custody.generateKey()) }),
      ),
    ),
  );
