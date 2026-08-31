import { Context, Effect, Schema } from "effect";
import type { ManagedDnsConnections } from "domainkit";

export class Error extends Schema.TaggedError<Error>()("CredentialCustodyError", {
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export interface Interface {
  readonly open: (
    ciphertext: string,
  ) => Effect.Effect<ManagedDnsConnections.StoredCredential, Error>;
  readonly seal: (
    credential: ManagedDnsConnections.StoredCredential,
  ) => Effect.Effect<string, Error>;
}

/** Host-owned encryption boundary. DomainKit never receives keys or stores plaintext. */
export class Service extends Context.Service<Service, Interface>()(
  "@domainkit/capsuledb/CredentialCustody",
) {}
