import { DateTime, Effect, Layer } from "effect";
import { DomainKit, Principal, Verify } from "domainkit";

declare const providers: DomainKit.Options["providers"];
declare const principal: Principal.Interface;
/** Your own durable queue, cron, or workflow scheduler. */
declare const wake: (input: { domain: string; at: Date }) => Effect.Effect<void>;
/** Whatever your application stores per domain. */
declare const markReady: (domain: string) => Effect.Effect<void>;
declare const domainsDue: Effect.Effect<ReadonlyArray<string>>;

// #region observer
/**
 * `Verify.Observer` fires once per stored readiness, after the write. It is the one place a host
 * learns that DomainKit wrote readiness, so a projection lives here instead of beside every call
 * that might have caused one.
 */
const observer = Layer.succeed(Verify.Observer, {
  readinessChanged: ({ cause, domain, readiness }) =>
    Effect.gen(function* () {
      if (readiness.overall === "ready") return yield* markReady(domain);
      // A pending domain carries its own schedule, so the host sleeps on it rather than polling.
      if (readiness.nextCheckAt !== null && cause === "observe") {
        yield* wake({ domain, at: new Date(DateTime.toEpochMillis(readiness.nextCheckAt)) });
      }
    }),
});

export const live = DomainKit.layer({ providers }).pipe(Layer.provideMerge(observer));
// #endregion observer

// #region job
/**
 * The clock is the host's. A job observes the domains that are due, and the observer above is what
 * tells the rest of the application that something changed.
 */
export const sweep = Effect.gen(function* () {
  const due = yield* domainsDue;
  yield* Effect.forEach(due, (domain) => Verify.observe({ domain }), { concurrency: 8 });
}).pipe(Effect.provideService(Principal.Service, principal));
// #endregion job

// #region snapshot
/**
 * A page or an API answers from the stored fact. `Verify.latest` reads it without observing, and
 * `Verify.summary` counts it, so nothing about the domain is decided twice.
 */
export const snapshot = (domain: string) =>
  Effect.map(Verify.latest(domain), (readiness) => ({
    readiness,
    ...Verify.summary(readiness),
  }));
// #endregion snapshot
