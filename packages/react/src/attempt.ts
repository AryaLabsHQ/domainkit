/**
 * The plan -> approve -> apply machine both `Provision` and `Cleanup` run. They differ only in
 * which plan they build and which event they emit when the receipt lands, so the machine lives
 * here once and each namespace exports its own controller over it.
 */
import type { Approval, DomainKit, Plan, Receipt } from "domainkit";
import type { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useRunner } from "./task.ts";

export type State = Data.TaggedEnum<{
  Idle: {};
  Planning: {};
  Planned: { readonly plan: Plan.Model };
  Approving: { readonly plan: Plan.Model };
  Applying: { readonly plan: Plan.Model; readonly approval: Approval.Model };
  Applied: { readonly plan: Plan.Model | null; readonly receipt: Receipt.Model };
  Rejecting: { readonly plan: Plan.Model };
  Rejected: { readonly plan: Plan.Model; readonly attempt: Transport.Attempt };
  Failure: { readonly error: DomainKit.Error };
}>;
export const State = Data.taggedEnum<State>();

/** The verbs `Provision` and `Cleanup` share on the wire. */
export interface Group {
  readonly approve: (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) => Effect.Effect<Approval.Model, DomainKit.Error>;
  readonly reject: (input: {
    readonly planId: Plan.PlanId;
    readonly reason?: string;
  }) => Effect.Effect<Transport.Attempt, DomainKit.Error>;
  readonly apply: (
    approvalId: Approval.ApprovalId,
  ) => Effect.Effect<Receipt.Model, DomainKit.Error>;
}

export interface Controller {
  readonly state: State;
  /** Build a plan. The plan itself rides on the state, from `Planned` through `Applied`. */
  readonly plan: () => void;
  /** Authorize the digest and apply it. Pass `operationIds` to approve part of the plan. */
  readonly approve: (operationIds?: ReadonlyArray<Plan.OperationId>) => void;
  /** Decline the plan. Terminal: approving it afterwards fails `Stale`. */
  readonly reject: (reason?: string) => void;
  /** Apply the approval this controller already holds. */
  readonly apply: () => void;
  /** Re-plan when the zone moved under the plan, otherwise re-run the step that failed. */
  readonly retry: () => void;
  readonly reset: () => void;
}

export interface Options {
  readonly domain: string;
  /**
   * Identifies the inputs this attempt is for. When it changes the attempt is abandoned, because a
   * plan, approval, and receipt only mean anything for the inputs that produced them.
   */
  readonly key: string;
  readonly group: Group | undefined;
  /** The plan call, or `null` when this flow has nothing to plan yet. */
  readonly plan: () => Effect.Effect<Plan.Model, DomainKit.Error> | null;
  readonly done: (receipt: Receipt.Model) => Event;
  readonly onDone: ((receipt: Receipt.Model) => void) | undefined;
}

/** Reasons that mean the plan itself is gone: retrying the same step would fail the same way. */
const needsNewPlan = (error: DomainKit.Error): boolean =>
  error.reason._tag === "Stale" ||
  error.reason._tag === "Expired" ||
  error.reason._tag === "Conflict";

/** The plan an attempt holds, whatever step it is on; `null` before there is one. */
export const planOf = (state: State): Plan.Model | null => {
  switch (state._tag) {
    case "Planned":
    case "Approving":
    case "Applying":
    case "Rejecting":
    case "Rejected":
    case "Applied":
      return state.plan;
    case "Idle":
    case "Planning":
    case "Failure":
      return null;
  }
};

/**
 * The plan still awaiting its apply, which is what a row of records reports; `null` once one has
 * landed, because from then on an observation answers instead.
 */
export const pendingPlan = (state: State): Plan.Model | null => {
  switch (state._tag) {
    case "Planned":
    case "Approving":
    case "Applying":
      return state.plan;
    case "Idle":
    case "Planning":
    case "Applied":
    case "Rejecting":
    case "Rejected":
    case "Failure":
      return null;
  }
};

export function useAttempt(options: Options): Controller {
  const { domain, done, group, key, onDone } = options;
  const { emit } = useDomainKit();
  const readOnly = useReadOnly();
  const runner = useRunner();
  const [state, setState] = useState<State>(State.Idle());
  // The key travels with what it produced, so a command raised before the reset commits still
  // refuses to run: a plan built for one domain must never be approved for another.
  const held = useRef<{
    key: string;
    plan: Plan.Model | null;
    approval: Approval.Model | null;
  }>({ approval: null, key, plan: null });
  const lastCommand = useRef<{ key: string; run: () => void } | null>(null);
  const build = useRef(options.plan);
  useEffect(() => {
    build.current = options.plan;
  });

  // Abandoning while rendering, not one effect later, is what makes the guards below sound: a
  // reply that lands in between finds the new key already recorded and drops itself.
  const [current, setCurrent] = useState(key);
  if (current !== key) {
    setCurrent(key);
    runner.cancel();
    held.current = { approval: null, key, plan: null };
    lastCommand.current = null;
    setState(State.Idle());
  }

  const onFailure = useCallback(
    (error: DomainKit.Error) => {
      setState(State.Failure({ error }));
      emit(Event.Failed({ domain, error }));
    },
    [domain, emit],
  );

  const applyWith = useCallback(
    (plan: Plan.Model, approval: Approval.Model) => {
      if (group === undefined || held.current.key !== key) return;
      const command = () => {
        setState(State.Applying({ approval, plan }));
        runner.run(group.apply(approval.id), {
          onFailure,
          onSuccess: (receipt) => {
            setState(State.Applied({ plan, receipt }));
            emit(done(receipt));
            onDone?.(receipt);
          },
        });
      };
      lastCommand.current = { key, run: command };
      command();
    },
    [done, emit, group, key, onDone, onFailure, runner],
  );

  const buildPlan = useCallback(() => {
    const effect = build.current();
    if (effect === null) return;
    const command = () => {
      setState(State.Planning());
      runner.run(effect, {
        onFailure,
        onSuccess: (plan) => {
          if (held.current.key !== key) return;
          held.current = { approval: null, key, plan };
          setState(State.Planned({ plan }));
        },
      });
    };
    lastCommand.current = { key, run: command };
    command();
  }, [key, onFailure, runner]);

  const approve = useCallback(
    (operationIds?: ReadonlyArray<Plan.OperationId>) => {
      const plan = held.current.plan;
      if (group === undefined || plan === null || held.current.key !== key) return;
      const command = () => {
        setState(State.Approving({ plan }));
        runner.run(
          group.approve({
            planId: plan.id,
            ...(operationIds === undefined ? {} : { operationIds }),
          }),
          {
            onFailure,
            onSuccess: (approval) => {
              if (held.current.key !== key) return;
              held.current = { approval, key, plan };
              applyWith(plan, approval);
            },
          },
        );
      };
      lastCommand.current = { key, run: command };
      command();
    },
    [applyWith, group, key, onFailure, runner],
  );

  const reject = useCallback(
    (reason?: string) => {
      const plan = held.current.plan;
      if (group === undefined || plan === null || held.current.key !== key) return;
      const command = () => {
        setState(State.Rejecting({ plan }));
        runner.run(group.reject({ planId: plan.id, ...(reason === undefined ? {} : { reason }) }), {
          onFailure,
          onSuccess: (attempt) => {
            setState(State.Rejected({ attempt, plan }));
            emit(Event.Declined({ attempt, domain }));
          },
        });
      };
      lastCommand.current = { key, run: command };
      command();
    },
    [domain, emit, group, key, onFailure, runner],
  );

  const apply = useCallback(() => {
    const { approval, plan } = held.current;
    if (approval === null || plan === null) return;
    applyWith(plan, approval);
  }, [applyWith]);

  const retry = useCallback(() => {
    // Every step of an attempt is a write, so read-only has nothing to retry.
    if (readOnly) return;
    if (state._tag === "Failure" && needsNewPlan(state.error)) {
      held.current = { approval: null, key, plan: null };
      buildPlan();
      return;
    }
    const command = lastCommand.current;
    if (command === null || command.key !== key) buildPlan();
    else command.run();
  }, [buildPlan, key, readOnly, state]);

  const reset = useCallback(() => {
    runner.cancel();
    held.current = { approval: null, key, plan: null };
    lastCommand.current = null;
    setState(State.Idle());
  }, [key, runner]);

  return { apply, approve, plan: buildPlan, reject, reset, retry, state };
}
