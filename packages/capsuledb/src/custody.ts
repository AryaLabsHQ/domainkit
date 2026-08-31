import { Context, Effect, Schema } from "effect";
import type { ManagedDnsConnections } from "domainkit";

/** Secret token material; credential expiry remains ordinary lifecycle metadata. */
export type Credential = Omit<ManagedDnsConnections.StoredCredential, "expiresAt">;

export class Error extends Schema.TaggedError<Error>()("CredentialCustodyError", {
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export interface Interface {
  readonly open: (ciphertext: string) => Effect.Effect<Credential, Error>;
  readonly seal: (credential: Credential) => Effect.Effect<string, Error>;
}

/** Host-owned encryption boundary. DomainKit never receives keys or stores plaintext. */
export class Service extends Context.Service<Service, Interface>()(
  "@domainkit/capsuledb/CredentialCustody",
) {}
