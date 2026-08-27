import type { DomainName } from "../domain/domain-name.ts";
import { parseDomainName } from "../domain/domain-name.ts";
import { AuthorizationError } from "../errors.ts";
import type { Connection } from "./types.ts";

export function assertConnectionGrant(
  connection: Connection,
  request: {
    readonly accountId: string;
    readonly capability: Connection["capabilities"][number];
    readonly domain: string;
    readonly now?: Date;
    readonly providerId: string;
  },
): DomainName {
  if (connection.providerId !== request.providerId || connection.accountId !== request.accountId) {
    throw new AuthorizationError({ message: "Connection does not grant this provider account" });
  }
  if (
    connection.expiresAt !== null &&
    new Date(connection.expiresAt) <= (request.now ?? new Date())
  ) {
    throw new AuthorizationError({ message: "Connection has expired" });
  }
  if (!connection.capabilities.includes(request.capability)) {
    throw new AuthorizationError({
      message: `Connection lacks the ${request.capability} capability`,
    });
  }
  const domain = parseDomainName(request.domain);
  if (connection.grant._tag === "domains" && !connection.grant.domains.includes(domain)) {
    throw new AuthorizationError({ message: "Connection does not grant this domain" });
  }
  return domain;
}
