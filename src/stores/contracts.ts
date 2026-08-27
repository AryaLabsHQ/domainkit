import { Context, Effect, Layer } from "effect";

import type { Connection, OAuthContinuation, StoredCredential } from "../auth/types.ts";
import { StorageError } from "../errors.ts";
import type { ApplyReceipt } from "../plan/types.ts";

export interface OAuthStateStoreService {
  readonly consume: (
    stateHash: string,
    now: Date,
  ) => Effect.Effect<OAuthContinuation | null, StorageError>;
  readonly put: (continuation: OAuthContinuation) => Effect.Effect<void, StorageError>;
}

export interface ConnectionStoreService {
  readonly get: (connectionId: string) => Effect.Effect<Connection | null, StorageError>;
  readonly put: (connection: Connection) => Effect.Effect<void, StorageError>;
}

/** Hosts must encrypt values held by this interface at rest. */
export interface CredentialStoreService {
  readonly delete: (connectionId: string) => Effect.Effect<void, StorageError>;
  readonly get: (connectionId: string) => Effect.Effect<StoredCredential | null, StorageError>;
  readonly put: (
    connectionId: string,
    credential: StoredCredential,
  ) => Effect.Effect<void, StorageError>;
}

export interface ReceiptStoreService {
  readonly get: (planDigest: string) => Effect.Effect<ApplyReceipt | null, StorageError>;
  readonly put: (receipt: ApplyReceipt) => Effect.Effect<void, StorageError>;
}

export const OAuthStateStore = Context.Service<OAuthStateStoreService>("domainkit/OAuthStateStore");
export const ConnectionStore = Context.Service<ConnectionStoreService>("domainkit/ConnectionStore");
export const CredentialStore = Context.Service<CredentialStoreService>("domainkit/CredentialStore");
export const ReceiptStore = Context.Service<ReceiptStoreService>("domainkit/ReceiptStore");

export interface PromiseOAuthStateStore {
  readonly consume: (stateHash: string, now: Date) => Promise<OAuthContinuation | null>;
  readonly put: (continuation: OAuthContinuation) => Promise<void>;
}

export interface PromiseConnectionStore {
  readonly get: (connectionId: string) => Promise<Connection | null>;
  readonly put: (connection: Connection) => Promise<void>;
}

export interface PromiseCredentialStore {
  readonly delete: (connectionId: string) => Promise<void>;
  readonly get: (connectionId: string) => Promise<StoredCredential | null>;
  readonly put: (connectionId: string, credential: StoredCredential) => Promise<void>;
}

export interface PromiseReceiptStore {
  readonly get: (planDigest: string) => Promise<ApplyReceipt | null>;
  readonly put: (receipt: ApplyReceipt) => Promise<void>;
}

export interface PromiseStores {
  readonly connections: PromiseConnectionStore;
  readonly credentials: PromiseCredentialStore;
  readonly oauthState: PromiseOAuthStateStore;
  readonly receipts?: PromiseReceiptStore;
}

/** Bridges host-owned async persistence into Effect-native store services. */
export function storeLayersFromPromise(stores: PromiseStores) {
  const required = Layer.mergeAll(
    Layer.succeed(OAuthStateStore)(oauthStateFromPromise(stores.oauthState)),
    Layer.succeed(ConnectionStore)(connectionFromPromise(stores.connections)),
    Layer.succeed(CredentialStore)(credentialFromPromise(stores.credentials)),
  );
  return stores.receipts === undefined
    ? required
    : Layer.merge(required, Layer.succeed(ReceiptStore)(receiptFromPromise(stores.receipts)));
}

export function oauthStateLayerFromPromise(
  store: PromiseOAuthStateStore,
): Layer.Layer<OAuthStateStoreService> {
  return Layer.succeed(OAuthStateStore)(oauthStateFromPromise(store));
}

export function connectionLayerFromPromise(
  store: PromiseConnectionStore,
): Layer.Layer<ConnectionStoreService> {
  return Layer.succeed(ConnectionStore)(connectionFromPromise(store));
}

export function credentialLayerFromPromise(
  store: PromiseCredentialStore,
): Layer.Layer<CredentialStoreService> {
  return Layer.succeed(CredentialStore)(credentialFromPromise(store));
}

function oauthStateFromPromise(store: PromiseOAuthStateStore): OAuthStateStoreService {
  return {
    consume: (stateHash, now) =>
      liftStorage("oauthState.consume", () => store.consume(stateHash, now)),
    put: (continuation) => liftStorage("oauthState.put", () => store.put(continuation)),
  };
}

function connectionFromPromise(store: PromiseConnectionStore): ConnectionStoreService {
  return {
    get: (connectionId) => liftStorage("connection.get", () => store.get(connectionId)),
    put: (connection) => liftStorage("connection.put", () => store.put(connection)),
  };
}

function credentialFromPromise(store: PromiseCredentialStore): CredentialStoreService {
  return {
    delete: (connectionId) => liftStorage("credential.delete", () => store.delete(connectionId)),
    get: (connectionId) => liftStorage("credential.get", () => store.get(connectionId)),
    put: (connectionId, credential) =>
      liftStorage("credential.put", () => store.put(connectionId, credential)),
  };
}

function receiptFromPromise(store: PromiseReceiptStore): ReceiptStoreService {
  return {
    get: (planDigest) => liftStorage("receipt.get", () => store.get(planDigest)),
    put: (receipt) => liftStorage("receipt.put", () => store.put(receipt)),
  };
}

function liftStorage<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) =>
      cause instanceof StorageError
        ? cause
        : new StorageError({
            message: cause instanceof Error ? cause.message : String(cause),
            operation,
          }),
  });
}
