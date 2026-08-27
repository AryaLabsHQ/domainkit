import { Effect, Layer } from "effect";

import type { Connection, OAuthContinuation, StoredCredential } from "../auth/types.ts";
import type { ApplyReceipt } from "../plan/types.ts";
import {
  ConnectionStore,
  type ConnectionStoreService,
  CredentialStore,
  type CredentialStoreService,
  OAuthStateStore,
  type OAuthStateStoreService,
  type PromiseConnectionStore,
  type PromiseCredentialStore,
  type PromiseOAuthStateStore,
  type PromiseReceiptStore,
  ReceiptStore,
  type ReceiptStoreService,
} from "./contracts.ts";

export class InMemoryOAuthStateStore implements OAuthStateStoreService {
  readonly #continuations = new Map<string, OAuthContinuation>();

  put(continuation: OAuthContinuation): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#continuations.set(continuation.stateHash, continuation);
    });
  }

  consume(stateHash: string, now: Date): Effect.Effect<OAuthContinuation | null> {
    return Effect.sync(() => {
      const continuation = this.#continuations.get(stateHash) ?? null;
      if (continuation === null) return null;
      this.#continuations.delete(stateHash);
      return new Date(continuation.expiresAt) > now ? continuation : null;
    });
  }

  get layer(): Layer.Layer<OAuthStateStoreService> {
    return Layer.succeed(OAuthStateStore)(this);
  }

  get promise(): PromiseOAuthStateStore {
    return {
      consume: (stateHash, now) => Effect.runPromise(this.consume(stateHash, now)),
      put: (continuation) => Effect.runPromise(this.put(continuation)),
    };
  }
}

export class InMemoryConnectionStore implements ConnectionStoreService {
  readonly #connections = new Map<string, Connection>();

  get(connectionId: string): Effect.Effect<Connection | null> {
    return Effect.sync(() => this.#connections.get(connectionId) ?? null);
  }

  put(connection: Connection): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#connections.set(connection.id, connection);
    });
  }

  get layer(): Layer.Layer<ConnectionStoreService> {
    return Layer.succeed(ConnectionStore)(this);
  }

  get promise(): PromiseConnectionStore {
    return {
      get: (connectionId) => Effect.runPromise(this.get(connectionId)),
      put: (connection) => Effect.runPromise(this.put(connection)),
    };
  }
}

export class InMemoryCredentialStore implements CredentialStoreService {
  readonly #credentials = new Map<string, StoredCredential>();

  delete(connectionId: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#credentials.delete(connectionId);
    });
  }

  get(connectionId: string): Effect.Effect<StoredCredential | null> {
    return Effect.sync(() => this.#credentials.get(connectionId) ?? null);
  }

  put(connectionId: string, credential: StoredCredential): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#credentials.set(connectionId, credential);
    });
  }

  get layer(): Layer.Layer<CredentialStoreService> {
    return Layer.succeed(CredentialStore)(this);
  }

  get promise(): PromiseCredentialStore {
    return {
      delete: (connectionId) => Effect.runPromise(this.delete(connectionId)),
      get: (connectionId) => Effect.runPromise(this.get(connectionId)),
      put: (connectionId, credential) => Effect.runPromise(this.put(connectionId, credential)),
    };
  }
}

export class InMemoryReceiptStore implements ReceiptStoreService {
  readonly #receipts = new Map<string, ApplyReceipt>();

  get(planDigest: string): Effect.Effect<ApplyReceipt | null> {
    return Effect.sync(() => this.#receipts.get(planDigest) ?? null);
  }

  put(receipt: ApplyReceipt): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#receipts.set(receipt.planDigest, receipt);
    });
  }

  get layer(): Layer.Layer<ReceiptStoreService> {
    return Layer.succeed(ReceiptStore)(this);
  }

  get promise(): PromiseReceiptStore {
    return {
      get: (planDigest) => Effect.runPromise(this.get(planDigest)),
      put: (receipt) => Effect.runPromise(this.put(receipt)),
    };
  }
}
