import type { Connection } from "../auth/types.ts";
import { assertConnectionGrant } from "../auth/grants.ts";
import type { DomainName } from "../domain/domain-name.ts";
import { parseDomainName } from "../domain/domain-name.ts";
import { AuthorizationError } from "../errors.ts";
import { deriveZoneCandidates } from "./zones.ts";

export interface ConnectedZone {
  readonly accountId: string;
  readonly connection: Connection;
  readonly nameservers: ReadonlyArray<string>;
  readonly providerId: string;
  readonly zone: string;
}

export interface ProviderCandidateEvidence {
  readonly accountId: string;
  readonly connectionId: string;
  readonly decisiveNameserverMatch: boolean;
  readonly matchedNameservers: ReadonlyArray<string>;
  readonly providerId: string;
  readonly zone: DomainName;
}

export type ProviderSelection =
  | {
      readonly _tag: "selected";
      readonly candidate: ProviderCandidateEvidence;
      readonly evidence: ReadonlyArray<ProviderCandidateEvidence>;
      readonly reason: "explicit" | "unique-nameserver-match";
    }
  | {
      readonly _tag: "manual";
      readonly evidence: ReadonlyArray<ProviderCandidateEvidence>;
      readonly reason: "ambiguous" | "unsupported";
    };

export function selectProvider(input: {
  readonly authoritativeNameservers: ReadonlyArray<string>;
  readonly connectedZones: ReadonlyArray<ConnectedZone>;
  readonly domain: string;
  readonly explicit?: {
    readonly accountId: string;
    readonly providerId: string;
    readonly zone: string;
  };
}): ProviderSelection {
  const domain = parseDomainName(input.domain);
  const zoneCandidates = new Set(deriveZoneCandidates(domain));
  const authoritative = normalizeNameservers(input.authoritativeNameservers);
  const eligible = input.connectedZones.filter((connected) => {
    if (!zoneCandidates.has(parseDomainName(connected.zone))) return false;
    try {
      assertConnectionGrant(connected.connection, {
        accountId: connected.accountId,
        domain,
        providerId: connected.providerId,
      });
      return true;
    } catch {
      return false;
    }
  });
  const evidence = eligible.map((connected) => evidenceFor(connected, authoritative));

  if (input.explicit !== undefined) {
    const explicitZone = parseDomainName(input.explicit.zone);
    const index = eligible.findIndex(
      (connected) =>
        connected.providerId === input.explicit?.providerId &&
        connected.accountId === input.explicit.accountId &&
        parseDomainName(connected.zone) === explicitZone,
    );
    if (index < 0) {
      throw new AuthorizationError({
        message: "Explicit provider zone is not connected or granted",
      });
    }
    return { _tag: "selected", candidate: evidence[index]!, evidence, reason: "explicit" };
  }

  const decisive = evidence.filter(({ decisiveNameserverMatch }) => decisiveNameserverMatch);
  return decisive.length === 1
    ? { _tag: "selected", candidate: decisive[0]!, evidence, reason: "unique-nameserver-match" }
    : {
        _tag: "manual",
        evidence,
        reason: decisive.length > 1 ? "ambiguous" : "unsupported",
      };
}

function evidenceFor(
  connected: ConnectedZone,
  authoritative: ReadonlyArray<string>,
): ProviderCandidateEvidence {
  const configured = new Set(normalizeNameservers(connected.nameservers));
  const matchedNameservers = authoritative.filter((nameserver) => configured.has(nameserver));
  return {
    accountId: connected.accountId,
    connectionId: connected.connection.id,
    decisiveNameserverMatch:
      authoritative.length > 0 && matchedNameservers.length === authoritative.length,
    matchedNameservers,
    providerId: connected.providerId,
    zone: parseDomainName(connected.zone),
  };
}

function normalizeNameservers(nameservers: ReadonlyArray<string>): ReadonlyArray<string> {
  return [
    ...new Set(nameservers.map((nameserver) => nameserver.toLowerCase().replace(/\.+$/, ""))),
  ].sort();
}
