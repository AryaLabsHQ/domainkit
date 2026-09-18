import { DnsRecord, Verify, type DomainKit } from "domainkit";
import type { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { requirementsKey } from "./records.ts";
import { useRunner } from "./task.ts";

export type Readiness = Transport.Readiness;
export type HostEvidence = Readiness["host"][number];
export type Requirement = Readiness["requirements"][number];
export type Evidence = Requirement["evidence"][number];

/** Counts across a readiness's requirements, from the core package. Pure, and total over `null`. */
export const summary = Verify.summary;
export type Summary = Verify.Summary;

/**
 * What the observer read back for the requirement's name, or `null` when it read nothing back at
 * all. Host evidence reports a status the host reached rather than values read off a name, and an
 * `unknown` observation is a lookup that never answered, which is not the same as finding nothing.
 */
export const valuesOf = (evidence: Evidence): ReadonlyArray<string> | null =>
  evidence._tag === "Host" || evidence.status === "unknown" ? null : evidence.values;

/**
 * Readiness rides on the state rather than a ref, so it can never outlive the render that
 * produced it: a controller pointed at a new domain has no readiness in the very first frame.
 */
export type State = Data.TaggedEnum<{
  Idle: {};
  Observing: { readonly readiness: Readiness | null };
  Observed: { readonly readiness: Readiness };
  Failure: { readonly error: DomainKit.Error; readonly readiness: Readiness | null };
}>;
export const State = Data.taggedEnum<State>();

const readinessOf = (state: State): Readiness | null =>
  state._tag === "Idle" ? null : state.readiness;

export interface Controller {
  readonly state: State;
  /** The latest readiness, kept while a new observation runs. */
  readonly readiness: Readiness | null;
  readonly observe: () => void;
  /** Observe again after a failure. */
  readonly retry: () => void;
  /** Whether this controller re-observes at `nextCheckAt` while mounted. */
  readonly polling: boolean;
}

/**
 * Readiness the host already holds, and how to ask it for a fresh one. A host that observes on its
 * own clock — a cron, a durable job, a server render — supplies the stored fact rather than letting
 * every mounted surface make an observation of its own.
 */
export interface Supplied {
  readonly readiness: Readiness | null;
  /** What `observe` and `retry` call. Absent means the surface cannot ask, and both do nothing. */
  readonly observe?: (() => void) | undefined;
}

export interface Options {
  readonly domain: string;
  /**
   * What to look for. Supplied requirements win over the attachment's latest provisioning receipt,
   * which is what lets a domain with no attachment be verified at all.
   */
  readonly requirements?: ReadonlyArray<DnsRecord.Model>;
  /** Re-observe at each `nextCheckAt` while mounted. Default true. */
  readonly polling?: boolean;
  /**
   * Take readiness from the host instead of observing. The controller then makes no observation on
   * mount, sets no timer, and reports `polling: false`; `observe` and `retry` call the host's.
   */
  readonly supplied?: Supplied | undefined;
}

/**
 * Observe once on mount, then follow the readiness's own `nextCheckAt` while polling is on — or,
 * given `supplied`, report the host's readiness and leave the clock to it.
 */
export function useController({
  domain,
  polling = true,
  requirements,
  supplied,
}: Options): Controller {
  const { emit, revision, transport } = useDomainKit();
  const verification = transport.verification;
  const runner = useRunner();
  const [state, setState] = useState<State>(State.Idle());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Requirements identify themselves by content, so a host writing the array inline does not
  // rebuild `observe` on every render and set the mount effect observing in a loop. The key covers
  // every field, because `policy` and `ttl` ride the wire and `policy` decides readiness.
  const signature = requirements === undefined ? null : requirementsKey(requirements);
  const requested = useMemo(
    () => (requirements === undefined ? undefined : { requirements }),
    [signature],
  );

  // Readiness belongs to the domain that was observed. Dropping it while rendering, rather than
  // in an effect, keeps the first frame for a new domain free of the previous one's evidence.
  // The domain travels with it, so an answer that arrives after the controller moved refuses
  // itself rather than hanging one domain's evidence under another's name.
  const held = useRef(domain);
  const [observed, setObserved] = useState(domain);
  if (observed !== domain) {
    setObserved(domain);
    held.current = domain;
    setState(State.Idle());
  }

  // The option's identity is the host's to churn, so the callbacks depend on the two facts in it
  // rather than on the object: whether the host owns the clock, and what it wants called.
  const hostOwned = supplied !== undefined;
  const hostObserve = supplied?.observe;
  const hostReadiness = supplied?.readiness ?? null;

  const observe = useCallback(() => {
    // The host owns the clock, so asking for a new reading is asking the host for one.
    if (hostOwned) {
      hostObserve?.();
      return;
    }
    if (verification === undefined) return;
    clearTimeout(timer.current);
    setState((previous) => State.Observing({ readiness: readinessOf(previous) }));
    runner.run(
      requested === undefined
        ? verification.observe(domain)
        : verification.observe(domain, requested),
      {
        onFailure: (error) => {
          if (held.current !== domain) return;
          setState((previous) => State.Failure({ error, readiness: readinessOf(previous) }));
          emit(Event.Failed({ domain, error }));
        },
        onSuccess: (readiness) => {
          if (held.current !== domain) return;
          setState(State.Observed({ readiness }));
        },
      },
    );
  }, [domain, emit, hostObserve, hostOwned, requested, runner, verification]);

  useEffect(() => {
    if (hostOwned) return;
    observe();
  }, [hostOwned, observe, revision]);

  useEffect(() => {
    if (!polling || state._tag !== "Observed") return;
    const next = state.readiness.nextCheckAt;
    if (next === null) return;
    const delay = Math.max(0, DateTime.toEpochMillis(next) - Date.now());
    timer.current = setTimeout(observe, delay);
    return () => clearTimeout(timer.current);
  }, [observe, polling, state]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A supplied readiness is a fact, not a state machine: the host has either read one or not.
  // The internal state stays `Idle` under it, which is what keeps the timer effect asleep.
  const suppliedState = useMemo(
    () => (hostReadiness === null ? State.Idle() : State.Observed({ readiness: hostReadiness })),
    [hostReadiness],
  );

  return {
    observe,
    polling: !hostOwned && polling,
    readiness: hostOwned ? hostReadiness : readinessOf(state),
    retry: observe,
    state: hostOwned ? suppliedState : state,
  };
}
