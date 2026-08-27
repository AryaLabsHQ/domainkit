import { Effect } from "effect";

import type * as ProviderAuth from "../auth/manifest.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as Vercel from "../providers/vercel/index.ts";

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

export function make(options: Vercel.Client.Options): Interface {
  const client = Vercel.make(options);
  return {
    id: client.id,
    createRecord: (zone, record) => Effect.runPromise(client.createRecord(zone, record)),
    listAccounts: () => Effect.runPromise(client.listAccounts()),
    listRecords: (zone) => Effect.runPromise(client.listRecords(zone)),
    listZones: (input) => Effect.runPromise(client.listZones(input)),
    validateToken: () => Effect.runPromise(client.validateToken()),
  };
}
