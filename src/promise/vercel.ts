import { Effect } from "effect";

import type * as ProviderAuth from "../auth/manifest.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as Vercel from "../providers/vercel/index.ts";
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
  readonly listAccounts: () => Promise<ReadonlyArray<Vercel.Account>>;
  readonly listZones: (input?: Vercel.Client.ListZonesInput) => Promise<ReadonlyArray<Vercel.Zone>>;
  readonly validateToken: () => Promise<ProviderAuth.TokenValidation>;
}

/** Creates a Promise-compatible facade over the Effect-native Vercel client. */
export function make(options: Vercel.Client.Options): Interface {
  const client = Vercel.make(options);
  return {
    id: client.id,
    createRecord: (zone, record) => Effect.runPromise(client.createRecord(zone, record)),
    deleteRecord: (zone, providerRecordId) =>
      Effect.runPromise(client.deleteRecord(zone, providerRecordId)),
    getRecord: (zone, providerRecordId) =>
      Effect.runPromise(client.getRecord(zone, providerRecordId)),
    listAccounts: () => Effect.runPromise(client.listAccounts()),
    listRecords: (zone) => Effect.runPromise(client.listRecords(zone)),
    listZones: (input) => Effect.runPromise(client.listZones(input)),
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
