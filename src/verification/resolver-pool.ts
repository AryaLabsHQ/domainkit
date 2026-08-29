import { Context, Data, Effect, Layer, Schema } from "effect";

import * as CloudflareDnsOverHttps from "./cloudflare-doh.ts";
import * as DnsOverHttps from "./doh.ts";
import * as DnsResolver from "./resolver.ts";
import * as GoogleDnsOverHttps from "./google-doh.ts";

export interface Entry {
  readonly id: string;
  readonly resolver: DnsResolver.Interface;
  readonly timeoutMs?: number;
}

export type Observation = Data.TaggedEnum<{
  Answer: { readonly answers: ReadonlyArray<DnsResolver.Answer>; readonly resolverId: string };
  Failed: {
    readonly message: string;
    readonly reason: Exclude<DnsResolver.Error["reason"], "timeout">;
    readonly resolverId: string;
  };
  NoData: { readonly resolverId: string };
  TimedOut: { readonly resolverId: string; readonly timeoutMs: number };
}>;
export const Observation = Data.taggedEnum<Observation>();

export type Policy = Data.TaggedEnum<{
  AllMatch: {};
  AnyMatch: {};
  Quorum: { readonly minimum: number };
}>;
const PolicyVariants = Data.taggedEnum<Policy>();
const QuorumMinimum = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const PolicySchema = Schema.TaggedUnion({
  AllMatch: {},
  AnyMatch: {},
  Quorum: { minimum: QuorumMinimum },
});
export const Policy = {
  AllMatch: PolicyVariants.AllMatch,
  AnyMatch: PolicyVariants.AnyMatch,
  Quorum: ({ minimum }: { readonly minimum: number }): Policy =>
    PolicyVariants.Quorum({ minimum: Schema.decodeUnknownSync(QuorumMinimum)(minimum) }),
  Schema: PolicySchema,
};

export interface Interface {
  readonly observe: (query: DnsResolver.Query) => Effect.Effect<ReadonlyArray<Observation>>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/DnsResolverPool") {}

export function make(entries: ReadonlyArray<Entry>): Interface {
  return Service.of({
    observe: Effect.fn("DnsResolverPool.observe")((query) =>
      Effect.forEach(entries, (entry) => observe(entry, query), { concurrency: "unbounded" }),
    ),
  });
}

export interface DefaultOptions extends Omit<DnsOverHttps.Options, "endpoint"> {}

/** Cloudflare and Google RFC wire-format DoH resolvers. */
export function defaultMake(options: DefaultOptions = {}): Interface {
  const timeoutMs = options.timeoutMs ?? 5_000;
  return make([
    {
      id: "cloudflare",
      resolver: CloudflareDnsOverHttps.make(options),
      timeoutMs,
    },
    { id: "google", resolver: GoogleDnsOverHttps.make(options), timeoutMs },
  ]);
}

export const defaultLayer = (options: DefaultOptions = {}): Layer.Layer<Service> =>
  Layer.succeed(Service, defaultMake(options));

function observe(entry: Entry, query: DnsResolver.Query): Effect.Effect<Observation> {
  const timeoutMs = entry.timeoutMs ?? 5_000;
  return entry.resolver.resolve(query).pipe(
    Effect.timeout(timeoutMs),
    Effect.match({
      onFailure: (failure): Observation => {
        if (
          failure._tag === "TimeoutError" ||
          (failure._tag === "ResolverError" && failure.reason === "timeout")
        ) {
          return Observation.TimedOut({ resolverId: entry.id, timeoutMs });
        }
        return Observation.Failed({
          message: failure.message,
          reason: failure.reason === "response" ? "response" : "transport",
          resolverId: entry.id,
        });
      },
      onSuccess: (resolution): Observation =>
        resolution._tag === "nodata"
          ? Observation.NoData({ resolverId: entry.id })
          : Observation.Answer({ answers: resolution.answers, resolverId: entry.id }),
    }),
  );
}
