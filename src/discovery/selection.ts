import { Schema } from "effect";

import * as Connection from "../auth/connection.ts";
import * as DomainName from "../domain/domain-name.ts";
import * as Zones from "./zones.ts";

export interface ConnectedZone {
  readonly accountId: string;
  readonly connection: Connection.Connection;
  readonly nameservers: ReadonlyArray<string>;
  readonly providerId: string;
  readonly zone: string;
}

export const Evidence = Schema.Struct({
  accountId: Schema.String,
  connectionId: Schema.String,
  decisiveNameserverMatch: Schema.Boolean,
  matchedNameservers: Schema.Array(DomainName.Schema),
  providerId: Schema.String,
  zone: DomainName.Schema,
});
export interface Evidence extends Schema.Schema.Type<typeof Evidence> {}

export const Selection = Schema.TaggedUnion({
  selected: {
    candidate: Evidence,
    evidence: Schema.Array(Evidence),
    reason: Schema.Literals(["explicit", "unique-nameserver-match"]),
  },
  manual: {
    evidence: Schema.Array(Evidence),
    reason: Schema.Literals(["ambiguous", "unsupported"]),
  },
});
export type Selection = typeof Selection.Type;

export function select(input: {
  readonly authoritativeNameservers: ReadonlyArray<string>;
  readonly connectedZones: ReadonlyArray<ConnectedZone>;
  readonly domain: string;
  readonly explicit?: {
    readonly accountId: string;
    readonly providerId: string;
    readonly zone: string;
  };
  readonly now?: Date;
}): Selection {
  const domain = DomainName.parse(input.domain);
  const zoneCandidates = new Set(Zones.candidates(domain));
  const authoritative = nameserverSet(input.authoritativeNameservers);
  const eligible = input.connectedZones.filter((connected) => {
    if (!zoneCandidates.has(DomainName.parse(connected.zone))) return false;
    try {
      Connection.assertGrant(connected.connection, {
        accountId: connected.accountId,
        capability: "dns:read",
        domain,
        ...(input.now === undefined ? {} : { now: input.now }),
        providerId: connected.providerId,
      });
      return true;
    } catch {
      return false;
    }
  });
  const evidence = eligible.map((connected) => evidenceFor(connected, authoritative));

  if (input.explicit !== undefined) {
    const explicitZone = DomainName.parse(input.explicit.zone);
    const index = eligible.findIndex(
      (connected) =>
        connected.providerId === input.explicit?.providerId &&
        connected.accountId === input.explicit.accountId &&
        DomainName.parse(connected.zone) === explicitZone,
    );
    if (index < 0) {
      throw new Connection.AuthorizationError({
        message: "Explicit provider zone is not connected or granted",
      });
    }
    const candidate = evidence[index];
    if (candidate === undefined) throw new Error("Eligible provider evidence is missing");
    return { _tag: "selected", candidate, evidence, reason: "explicit" };
  }

  const decisive = evidence.filter(({ decisiveNameserverMatch }) => decisiveNameserverMatch);
  const candidate = decisive[0];
  return decisive.length === 1 && candidate !== undefined
    ? { _tag: "selected", candidate, evidence, reason: "unique-nameserver-match" }
    : {
        _tag: "manual",
        evidence,
        reason: decisive.length > 1 ? "ambiguous" : "unsupported",
      };
}

function evidenceFor(
  connected: ConnectedZone,
  authoritative: ReadonlyArray<DomainName.DomainName>,
): Evidence {
  const configured = new Set(nameserverSet(connected.nameservers));
  const matchedNameservers = authoritative.filter((nameserver) => configured.has(nameserver));
  return {
    accountId: connected.accountId,
    connectionId: connected.connection.id,
    decisiveNameserverMatch:
      authoritative.length > 0 && matchedNameservers.length === authoritative.length,
    matchedNameservers,
    providerId: connected.providerId,
    zone: DomainName.parse(connected.zone),
  };
}

function nameserverSet(nameservers: ReadonlyArray<string>): ReadonlyArray<DomainName.DomainName> {
  return [...new Set(nameservers.map(DomainName.parse))].sort();
}
