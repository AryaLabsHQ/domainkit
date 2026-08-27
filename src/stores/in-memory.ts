import type { OAuthContinuation, StoredCredential, Connection } from "../auth/types.ts";
import type { ApplyReceipt } from "../plan/types.ts";
import type {
  ConnectionStore,
  CredentialStore,
  OAuthStateStore,
  ReceiptStore,
} from "./contracts.ts";

export class InMemoryOAuthStateStore implements OAuthStateStore {
  readonly #continuations = new Map<string, OAuthContinuation>();

  async put(continuation: OAuthContinuation): Promise<void> {
    this.#continuations.set(continuation.stateHash, continuation);
  }

  async consume(stateHash: string, now: Date): Promise<OAuthContinuation | null> {
    const continuation = this.#continuations.get(stateHash) ?? null;
    if (continuation === null) return null;
    this.#continuations.delete(stateHash);
    return new Date(continuation.expiresAt) > now ? continuation : null;
  }
}

export class InMemoryConnectionStore implements ConnectionStore {
  readonly #connections = new Map<string, Connection>();

  async get(connectionId: string): Promise<Connection | null> {
    return this.#connections.get(connectionId) ?? null;
  }

  async put(connection: Connection): Promise<void> {
    this.#connections.set(connection.id, connection);
  }
}

export class InMemoryCredentialStore implements CredentialStore {
  readonly #credentials = new Map<string, StoredCredential>();

  async delete(connectionId: string): Promise<void> {
    this.#credentials.delete(connectionId);
  }

  async get(connectionId: string): Promise<StoredCredential | null> {
    return this.#credentials.get(connectionId) ?? null;
  }

  async put(connectionId: string, credential: StoredCredential): Promise<void> {
    this.#credentials.set(connectionId, credential);
  }
}

export class InMemoryReceiptStore implements ReceiptStore {
  readonly #receipts = new Map<string, ApplyReceipt>();

  async get(planDigest: string): Promise<ApplyReceipt | null> {
    return this.#receipts.get(planDigest) ?? null;
  }

  async put(receipt: ApplyReceipt): Promise<void> {
    this.#receipts.set(receipt.planDigest, receipt);
  }
}
