import { Effect } from "effect";

import * as EffectSession from "../provider/session.ts";
import type * as Connection from "../auth/connection.ts";
import type * as DomainName from "../domain/domain-name.ts";
import * as EffectDnsProvider from "../provider/provider.ts";
import * as DnsProvider from "./dns-provider.ts";

export type { ListTargetsInput, Resolution } from "../provider/session.ts";

export interface Interface {
  readonly providerId: string;
  readonly listTargets: (
    input?: EffectSession.ListTargetsInput,
  ) => Promise<ReadonlyArray<Connection.ProviderTarget>>;
  readonly resolveTarget: (domain: DomainName.DomainName) => Promise<EffectSession.Resolution>;
  readonly forTarget: (target: Connection.ProviderTarget) => Promise<DnsProvider.Interface>;
}

export const fromEffect = (session: EffectSession.Interface): Interface => ({
  providerId: session.providerId,
  listTargets: (input) => Effect.runPromise(session.listTargets(input)),
  resolveTarget: (domain) => Effect.runPromise(session.resolveTarget(domain)),
  forTarget: (target) =>
    Effect.runPromise(session.forTarget(target)).then(EffectDnsProvider.toAsync),
});
