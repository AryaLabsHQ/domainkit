import { Effect } from "effect";

import type * as ProviderAuth from "../auth/manifest.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as Cloudflare from "../providers/cloudflare/index.ts";

export * as Auth from "./cloudflare-auth.ts";
export type {
  Account,
  Fetch,
  ListZonesInput,
  Options,
  Zone,
} from "../providers/cloudflare/client.ts";

export interface Interface extends DnsProvider.AsyncInterface {
  readonly listAccounts: () => Promise<ReadonlyArray<Cloudflare.Account>>;
  readonly listZones: (
    input?: Cloudflare.Client.ListZonesInput,
  ) => Promise<ReadonlyArray<Cloudflare.Zone>>;
  readonly validateToken: () => Promise<ProviderAuth.TokenValidation>;
}

/** Creates a Promise-compatible facade over the Effect-native Cloudflare client. */
export function make(options: Cloudflare.Client.Options): Interface {
  const client = Cloudflare.make(options);
  return {
    id: client.id,
    createRecord: (zone, record) => Effect.runPromise(client.createRecord(zone, record)),
    listAccounts: () => Effect.runPromise(client.listAccounts()),
    listRecords: (zone) => Effect.runPromise(client.listRecords(zone)),
    listZones: (input) => Effect.runPromise(client.listZones(input)),
    validateToken: () => Effect.runPromise(client.validateToken()),
  };
}
