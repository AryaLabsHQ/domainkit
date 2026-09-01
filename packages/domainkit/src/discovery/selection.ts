import { Schema } from "effect";

import * as ProviderAuthorization from "../auth/authorization.ts";
import * as Connection from "../auth/connection.ts";
import * as DomainName from "../domain/domain-name.ts";
import * as Zones from "./zones.ts";

export interface ConnectedZone {
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly attachment: Connection.DomainAttachment;
  readonly connection: Connection.ProviderConnection;
  readonly nameservers: ReadonlyArray<string>;
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

const SelectionSchema = Schema.TaggedUnion({
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

/** Provider selection schema and constructors for trusted discovery results. */
export const Selection = {
  Schema: SelectionSchema,
  manual: (input: Parameters<typeof SelectionSchema.cases.manual.make>[0]) =>
    SelectionSchema.cases.manual.make(input),
  selected: (input: Parameters<typeof SelectionSchema.cases.selected.make>[0]) =>
    SelectionSchema.cases.selected.make(input),
};
export type Selection = typeof SelectionSchema.Type;

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
    if (!zoneCandidates.has(connected.attachment.target.zoneName)) return false;
    try {
      Connection.assertAttachment({
        attachment: connected.attachment,
        capability: "dns:read",
        connection: connected.connection,
        domain,
        ...(input.now === undefined ? {} : { now: input.now }),
        providerId: connected.connection.providerId,
        authorization: connected.authorization,
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
        connected.connection.providerId === input.explicit?.providerId &&
        connected.attachment.target.accountId === input.explicit.accountId &&
        connected.attachment.target.zoneName === explicitZone,
    );
    if (index < 0) {
      throw Connection.authorizationError(
        "Explicit provider zone is not connected for this domain",
        "ProviderDiscovery.select",
      );
    }
    const candidate = evidence[index];
    if (candidate === undefined) throw new Error("Eligible provider evidence is missing");
    return Selection.selected({ candidate, evidence, reason: "explicit" });
  }

  const decisive = evidence.filter(({ decisiveNameserverMatch }) => decisiveNameserverMatch);
  const candidate = decisive[0];
  return decisive.length === 1 && candidate !== undefined
    ? Selection.selected({ candidate, evidence, reason: "unique-nameserver-match" })
    : Selection.manual({
        evidence,
        reason: decisive.length > 1 ? "ambiguous" : "unsupported",
      });
}

function evidenceFor(
  connected: ConnectedZone,
  authoritative: ReadonlyArray<DomainName.DomainName>,
): Evidence {
  const configured = new Set(nameserverSet(connected.nameservers));
  const matchedNameservers = authoritative.filter((nameserver) => configured.has(nameserver));
  return {
    accountId: connected.attachment.target.accountId,
    connectionId: connected.connection.id,
    decisiveNameserverMatch:
      authoritative.length > 0 && matchedNameservers.length === authoritative.length,
    matchedNameservers,
    providerId: connected.connection.providerId,
    zone: connected.attachment.target.zoneName,
  };
}

function nameserverSet(nameservers: ReadonlyArray<string>): ReadonlyArray<DomainName.DomainName> {
  return [...new Set(nameservers.map(DomainName.parse))].sort();
}
