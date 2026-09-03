/**
 * The plan -> approve -> apply machine both `Provision` and `Cleanup` run. They differ only in
 * which plan they build and which event they emit when the receipt lands, so the machine lives
 * here once and each namespace exports its own controller over it.
 */
import type { Approval, DomainKitError, Plan, Receipt } from "domainkit";
import type { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useRunner } from "./task.ts";

export type State = Data.TaggedEnum<{
  Idle: {};
  Planning: {};
  Planned: { readonly plan: Plan.Plan };
  Approving: { readonly plan: Plan.Plan };
  Applying: { readonly plan: Plan.Plan; readonly approval: Approval.Approval };
  Applied: { readonly plan: Plan.Plan | null; readonly receipt: Receipt.Receipt };
  Rejecting: { readonly plan: Plan.Plan };
  Rejected: { readonly plan: Plan.Plan; readonly attempt: Transport.Attempt };
  Failure: { readonly error: DomainKitError.DomainKitError };
}>;
export const State = Data.taggedEnum<State>();

/** The verbs `Provision` and `Cleanup` share on the wire. */
export interface Group {
  readonly approve: (input: {
    readonly planId: Plan.PlanId;
    readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  }) => Effect.Effect<Approval.Approval, DomainKitError.DomainKitError>;
  readonly reject: (input: {
    readonly planId: Plan.PlanId;
    readonly reason?: string;
  }) => Effect.Effect<Transport.Attempt, DomainKitError.DomainKitError>;
  readonly apply: (
    approvalId: Approval.ApprovalId,
  ) => Effect.Effect<Receipt.Receipt, DomainKitError.DomainKitError>;
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
  readonly plan: () => Effect.Effect<Plan.Plan, DomainKitError.DomainKitError> | null;
  readonly done: (receipt: Receipt.Receipt) => Event;
  readonly onDone: ((receipt: Receipt.Receipt) => void) | undefined;
}

/** Reasons that mean the plan itself is gone: retrying the same step would fail the same way. */
const needsNewPlan = (error: DomainKitError.DomainKitError): boolean =>
  error.reason._tag === "Stale" ||
  error.reason._tag === "Expired" ||
  error.reason._tag === "Conflict";

export function useAttempt(options: Options): Controller {
  const { domain, done, group, key, onDone } = options;
  const { emit } = useDomainKit();
  const runner = useRunner();
  const [state, setState] = useState<State>(State.Idle());
  // The key travels with what it produced, so a command raised before the reset commits still
  // refuses to run: a plan built for one domain must never be approved for another.
  const held = useRef<{
    key: string;
    plan: Plan.Plan | null;
    approval: Approval.Approval | null;
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
    (error: DomainKitError.DomainKitError) => {
      setState(State.Failure({ error }));
      emit(Event.Failed({ domain, error }));
    },
    [domain, emit],
  );

  const applyWith = useCallback(
    (plan: Plan.Plan, approval: Approval.Approval) => {
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
    if (state._tag === "Failure" && needsNewPlan(state.error)) {
      held.current = { approval: null, key, plan: null };
      buildPlan();
      return;
    }
    const command = lastCommand.current;
    if (command === null || command.key !== key) buildPlan();
    else command.run();
  }, [buildPlan, key, state]);

  const reset = useCallback(() => {
    runner.cancel();
    held.current = { approval: null, key, plan: null };
    lastCommand.current = null;
    setState(State.Idle());
  }, [key, runner]);

  return { apply, approve, plan: buildPlan, reject, reset, retry, state };
}
