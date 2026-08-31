import { Effect } from "effect";

import type * as Connection from "../auth/connection.ts";
import type * as ProviderAuth from "../auth/manifest.ts";
import type * as DomainName from "../domain/domain-name.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as Vercel from "../providers/vercel/index.ts";
import type * as ProviderSession from "../provider/session.ts";
import type * as ZoneDiscovery from "./zone-discovery.ts";

export * as Auth from "./vercel-auth.ts";
export type {
  Account,
  AccountContext,
  Fetch,
  ListZonesInput,
  Options,
  Zone,
} from "../providers/vercel/client.ts";

export interface Interface extends DnsProvider.AsyncInterface {
  readonly providerId: "vercel";
  readonly forTarget: (target: Connection.ProviderTarget) => Promise<DnsProvider.AsyncInterface>;
  readonly listAccounts: () => Promise<ReadonlyArray<Vercel.Account>>;
  readonly listZones: (input?: Vercel.Client.ListZonesInput) => Promise<ReadonlyArray<Vercel.Zone>>;
  readonly listTargets: (
    input?: ProviderSession.ListTargetsInput,
  ) => Promise<ReadonlyArray<Connection.ProviderTarget>>;
  readonly resolveTarget: (domain: DomainName.DomainName) => Promise<ProviderSession.Resolution>;
  readonly validateToken: () => Promise<ProviderAuth.TokenValidation>;
}

/** Creates a Promise-compatible facade over the Effect-native Vercel client. */
export function make(options: Vercel.Client.Options): Interface {
  const client = Vercel.make(options);
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

/** Creates the optional Vercel discovery source for Promise consumers. */
export function discovery(options: Vercel.Client.Options): ZoneDiscovery.Source {
  const client = make(options);
  return {
    listZones: (name) => client.listZones({ name }),
    provider: client,
  };
}
