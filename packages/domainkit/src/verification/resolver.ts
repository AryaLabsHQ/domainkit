import { Context, Effect, Layer, Schema } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";

export interface Query {
  readonly name: DomainName.DomainName;
  readonly signal?: AbortSignal;
  readonly type: DnsRecord.Type;
}

export const Answer = Schema.Struct({
  data: Schema.String,
  name: DomainName.Schema,
  ttl: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  type: DnsRecord.Type,
});
export interface Answer extends Schema.Schema.Type<typeof Answer> {}

const ResolutionSchema = Schema.TaggedUnion({
  answer: { answers: Schema.Array(Answer) },
  nodata: {},
});
/** DNS answer schema and constructor cases for trusted resolver values. */
export const Resolution = Object.assign(ResolutionSchema, {
  answer: ResolutionSchema.cases.answer,
  nodata: ResolutionSchema.cases.nodata,
});
export type Resolution = typeof Resolution.Type;

export class Error extends Schema.TaggedError<Error>()("ResolverError", {
  cause: Schema.optionalKey(Schema.Unknown),
  message: Schema.String,
  reason: Schema.Literals(["response", "timeout", "transport"]),
}) {}

export interface Interface {
  readonly resolve: (query: Query) => Effect.Effect<Resolution, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/DnsResolver") {}

const AsyncResolutionSchema = Schema.TaggedUnion({
  answer: { answers: Schema.Array(Answer) },
  nodata: {},
  timeout: {},
  failure: { message: Schema.String },
});
/** Promise bridge result schema and constructor cases, including typed failures. */
export const AsyncResolution = Object.assign(AsyncResolutionSchema, {
  answer: AsyncResolutionSchema.cases.answer,
  failure: AsyncResolutionSchema.cases.failure,
  nodata: AsyncResolutionSchema.cases.nodata,
  timeout: AsyncResolutionSchema.cases.timeout,
});
export type AsyncResolution = typeof AsyncResolution.Type;

export interface AsyncInterface {
  readonly resolve: (query: Query) => Promise<AsyncResolution>;
}

export const layerFromAsync = (resolver: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    resolve: Effect.fn("DnsResolver.resolve")((query) =>
      Effect.tryPromise({
        try: () => resolver.resolve(query),
        catch: (cause) =>
          new Error({
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
              return Effect.fail(new Error({ message: "DNS query timed out", reason: "timeout" }));
            case "failure":
              return Effect.fail(new Error({ message: resolution.message, reason: "transport" }));
          }
        }),
      ),
    ),
  });

export const toAsync = (resolver: Interface): AsyncInterface => ({
  resolve: (query) =>
    Effect.runPromise(
      resolver.resolve(query).pipe(
        Effect.match({
          onFailure: (failure): AsyncResolution =>
            failure.reason === "timeout"
              ? AsyncResolution.timeout.make({})
              : AsyncResolution.failure.make({ message: failure.message }),
          onSuccess: (resolution) => resolution,
        }),
      ),
    ),
});
