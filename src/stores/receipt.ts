import { Context, Effect, Layer } from "effect";

import type { ApplyReceipt } from "../plan/types.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly get: (planDigest: string) => Effect.Effect<ApplyReceipt | null, Error>;
  readonly put: (receipt: ApplyReceipt) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/ReceiptStore") {}

export interface AsyncInterface {
  readonly get: (planDigest: string) => Promise<ApplyReceipt | null>;
  readonly put: (receipt: ApplyReceipt) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  get: (planDigest) => Effect.runPromise(store.get(planDigest)),
  put: (receipt) => Effect.runPromise(store.put(receipt)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    get: Effect.fn("ReceiptStore.get")((planDigest) =>
      Effect.tryPromise({
        try: () => store.get(planDigest),
        catch: (cause) => fromCause("receipt.get", cause),
      }),
    ),
    put: Effect.fn("ReceiptStore.put")((receipt) =>
      Effect.tryPromise({
        try: () => store.put(receipt),
        catch: (cause) => fromCause("receipt.put", cause),
      }),
    ),
  });
