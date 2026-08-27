import type { ConnectionStore, CredentialStore } from "../stores/contracts.ts";
import { Secret } from "./secret.ts";
import type { Connection, ConnectionGrant, TokenValidation } from "./types.ts";

export async function connectToken(input: {
  readonly connectionStore: ConnectionStore;
  readonly credentialStore: CredentialStore;
  readonly grant: ConnectionGrant;
  readonly now?: () => Date;
  readonly providerId: string;
  readonly subjectId: string;
  readonly token: Secret;
  readonly validate: (token: Secret) => Promise<TokenValidation>;
}): Promise<Connection> {
  const validation = await input.validate(input.token);
  const connection: Connection = {
    accountId: validation.accountId,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    expiresAt: validation.expiresAt,
    grant: input.grant,
    id: crypto.randomUUID(),
    kind: "token",
    providerId: input.providerId,
    scopes: [...validation.scopes],
    subjectId: input.subjectId,
  };
  await input.credentialStore.put(connection.id, {
    accessToken: input.token,
    refreshToken: null,
    tokenType: "bearer",
  });
  await input.connectionStore.put(connection);
  return connection;
}
