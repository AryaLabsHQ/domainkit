import { Effect } from "effect";

import * as DnsResolver from "../verification/resolver.ts";
import * as Pool from "../verification/resolver-pool.ts";

export interface Entry {
  readonly id: string;
  readonly resolver: DnsResolver.AsyncInterface;
  readonly timeoutMs?: number;
}

export interface Interface {
  readonly observe: (query: DnsResolver.Query) => Promise<ReadonlyArray<Pool.Observation>>;
}

export function make(entries: ReadonlyArray<Entry>): Interface {
  return toAsync(
    Pool.make(
      entries.map((entry) => ({
        id: entry.id,
        resolver: asyncResolver(entry.resolver),
        ...(entry.timeoutMs === undefined ? {} : { timeoutMs: entry.timeoutMs }),
      })),
    ),
  );
}

export function defaultMake(options: Pool.DefaultOptions = {}): Interface {
  return toAsync(Pool.defaultMake(options));
}

export { Observation, Policy } from "../verification/resolver-pool.ts";

function toAsync(pool: Pool.Interface): Interface {
  return {
    observe: (query) => Effect.runPromise(pool.observe(query)),
  };
}

function asyncResolver(resolver: DnsResolver.AsyncInterface): DnsResolver.Interface {
  return {
    resolve: (query) =>
      Effect.tryPromise({
        try: () => resolver.resolve(query),
        catch: (cause) =>
          new DnsResolver.Error({
            cause,
            message: cause instanceof globalThis.Error ? cause.message : String(cause),
            reason: "transport",
          }),
      }).pipe(
        Effect.flatMap((resolution) => {
          switch (resolution._tag) {
            case "answer":
            case "nodata":
              return Effect.succeed(resolution);
            case "timeout":
              return Effect.fail(
                new DnsResolver.Error({ message: "DNS query timed out", reason: "timeout" }),
              );
            case "failure":
              return Effect.fail(
                new DnsResolver.Error({ message: resolution.message, reason: "transport" }),
              );
          }
        }),
      ),
  };
}
