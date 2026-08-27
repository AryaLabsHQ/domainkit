import { Effect, Layer } from "effect";

import type * as DnsPlan from "../plan/types.ts";
import * as ReceiptStore from "./receipt.ts";

export function make(): ReceiptStore.Interface {
  const receipts = new Map<string, DnsPlan.ApplyReceipt>();
  return {
    get: Effect.fn("InMemoryReceiptStore.get")((planDigest) =>
      Effect.sync(() => receipts.get(planDigest) ?? null),
    ),
    put: Effect.fn("InMemoryReceiptStore.put")((receipt) =>
      Effect.sync(() => void receipts.set(receipt.planDigest, receipt)),
    ),
  };
}

export const layer = (): Layer.Layer<ReceiptStore.Service> =>
  Layer.succeed(ReceiptStore.Service, make());

export const toAsync = (store: ReceiptStore.Interface = make()): ReceiptStore.AsyncInterface =>
  ReceiptStore.toAsync(store);
