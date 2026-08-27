import type { ApplyReceipt } from "../plan/types.ts";
import type { Connection, OAuthContinuation, StoredCredential } from "../auth/types.ts";

export interface OAuthStateStore {
  readonly consume: (stateHash: string, now: Date) => Promise<OAuthContinuation | null>;
  readonly put: (continuation: OAuthContinuation) => Promise<void>;
}

export interface ConnectionStore {
  readonly get: (connectionId: string) => Promise<Connection | null>;
  readonly put: (connection: Connection) => Promise<void>;
}

/** Hosts must encrypt values held by this interface at rest. */
export interface CredentialStore {
  readonly delete: (connectionId: string) => Promise<void>;
  readonly get: (connectionId: string) => Promise<StoredCredential | null>;
  readonly put: (connectionId: string, credential: StoredCredential) => Promise<void>;
}

export interface ReceiptStore {
  readonly get: (planDigest: string) => Promise<ApplyReceipt | null>;
  readonly put: (receipt: ApplyReceipt) => Promise<void>;
}
