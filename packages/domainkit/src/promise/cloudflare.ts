import { Effect } from "effect";

import type * as Connection from "../auth/connection.ts";
import type * as ProviderAuth from "../auth/manifest.ts";
import type * as DomainName from "../domain/domain-name.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as Cloudflare from "../providers/cloudflare/index.ts";
import type * as ProviderSession from "../provider/session.ts";
import type * as ZoneDiscovery from "./zone-discovery.ts";

export * as Auth from "./cloudflare-auth.ts";
export type {
  Account,
  Fetch,
  ListZonesInput,
  Options,
  Zone,
} from "../providers/cloudflare/client.ts";

export interface Interface extends DnsProvider.AsyncInterface {
  readonly providerId: "cloudflare";
  readonly forTarget: (target: Connection.ProviderTarget) => Promise<DnsProvider.AsyncInterface>;
  readonly listAccounts: () => Promise<ReadonlyArray<Cloudflare.Account>>;
  readonly listZones: (
    input?: Cloudflare.Client.ListZonesInput,
  ) => Promise<ReadonlyArray<Cloudflare.Zone>>;
  readonly listTargets: (
    input?: ProviderSession.ListTargetsInput,
  ) => Promise<ReadonlyArray<Connection.ProviderTarget>>;
  readonly resolveTarget: (domain: DomainName.DomainName) => Promise<ProviderSession.Resolution>;
  readonly validateToken: () => Promise<ProviderAuth.TokenValidation>;
}

/** Creates a Promise-compatible facade over the Effect-native Cloudflare client. */
export function make(options: Cloudflare.Client.Options): Interface {
  const client = Cloudflare.make(options);
  return {
    id: client.id,
    providerId: client.providerId,
    createRecord: (zone, record) => Effect.runPromise(client.createRecord(zone, record)),
    deleteRecord: (zone, providerRecordId) =>
      Effect.runPromise(client.deleteRecord(zone, providerRecordId)),
    getRecord: (zone, providerRecordId) =>
      Effect.runPromise(client.getRecord(zone, providerRecordId)),
    listAccounts: () => Effect.runPromise(client.listAccounts()),
    listRecords: (zone) => Effect.runPromise(client.listRecords(zone)),
    listZones: (input) => Effect.runPromise(client.listZones(input)),
    listTargets: (input) => Effect.runPromise(client.listTargets(input)),
    resolveTarget: (domain) => Effect.runPromise(client.resolveTarget(domain)),
    forTarget: (target) =>
      Effect.runPromise(client.forTarget(target)).then((provider) => ({
        id: provider.id,
        createRecord: (zone, record) => Effect.runPromise(provider.createRecord(zone, record)),
        deleteRecord: (zone, providerRecordId) =>
          Effect.runPromise(provider.deleteRecord(zone, providerRecordId)),
        getRecord: (zone, providerRecordId) =>
          Effect.runPromise(provider.getRecord(zone, providerRecordId)),
        listRecords: (zone) => Effect.runPromise(provider.listRecords(zone)),
      })),
    validateToken: () => Effect.runPromise(client.validateToken()),
  };
}

/** Creates the optional Cloudflare discovery source for Promise consumers. */
export function discovery(options: Cloudflare.Client.Options): ZoneDiscovery.Source {
  const client = make(options);
  return {
    listZones: async (name) =>
      (await client.listZones({ name })).map((zone) => ({
        ...zone,
        status: zone.status === "active" || zone.status === "pending" ? zone.status : "unknown",
      })),
    provider: client,
  };
}
