import { DnsRecord, type DomainKit } from "domainkit";
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

export interface Options {
  readonly domain: string;
  /**
   * What to look for. Supplied requirements win over the attachment's latest provisioning receipt,
   * which is what lets a domain with no attachment be verified at all.
   */
  readonly requirements?: ReadonlyArray<DnsRecord.Model>;
  /** Re-observe at each `nextCheckAt` while mounted. Default true. */
  readonly polling?: boolean;
}

/** Observe once on mount, then follow the readiness's own `nextCheckAt` while polling is on. */
export function useController({ domain, polling = true, requirements }: Options): Controller {
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

  const observe = useCallback(() => {
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
  }, [domain, emit, requested, runner, verification]);

  useEffect(() => {
    observe();
  }, [observe, revision]);

  useEffect(() => {
    if (!polling || state._tag !== "Observed") return;
    const next = state.readiness.nextCheckAt;
    if (next === null) return;
    const delay = Math.max(0, DateTime.toEpochMillis(next) - Date.now());
    timer.current = setTimeout(observe, delay);
    return () => clearTimeout(timer.current);
  }, [observe, polling, state]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    observe,
    polling,
    readiness: readinessOf(state),
    retry: observe,
    state,
  };
}
