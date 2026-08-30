import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo, useRef } from "react";

import { failureFromCause, recordsIdentity, type Failure } from "./atom.ts";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Records from "./records.tsx";

export type State =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Planning" }
  | { readonly _tag: "Review"; readonly plan: Transport.ProvisioningPlan }
  | { readonly _tag: "Applying"; readonly plan: Transport.ProvisioningPlan }
  | {
      readonly _tag: "Complete";
      readonly result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" }>;
    }
  | {
      readonly _tag: "Partial";
      readonly result: Extract<Transport.ApplyResult, { readonly _tag: "Partial" }>;
    }
  | { readonly _tag: "Stale"; readonly message: string }
  | Failure;

export interface Controller {
  readonly apply: () => void;
  readonly dismiss: () => void;
  readonly plan: () => void;
  readonly retry: () => void;
  readonly state: State;
}

type Command = Data.TaggedEnum<{
  Apply: { readonly plan: Transport.ProvisioningPlan };
  Plan: {};
}>;
const Command = Data.taggedEnum<Command>();

export function useController(
  connection: Transport.Connected,
  records: ReadonlyArray<Transport.DnsRecord>,
  onApplied?: (
    result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void,
): Controller {
  const { runtime } = useDomainKit();
  const recordKey = recordsIdentity(records);
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;
  const controller = useMemo(() => {
    const state = Atom.make<State>({ _tag: "Idle" });
    const execute = runtime.fn<Command>()((command, get) => {
      if (command._tag === "Plan") {
        get.set(state, { _tag: "Planning" });
        return Effect.flatMap(Transport.Service, (transport) =>
          transport.provisioning.plan({
            connectionId: connection.connectionId,
            domain: connection.domain,
            records,
          }),
        ).pipe(
          Effect.tap((plan) => Effect.sync(() => get.set(state, { _tag: "Review", plan }))),
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              get.set(
                state,
                failureFromCause(cause, "provisioning.plan", "DNS provisioning failed"),
              ),
            ),
          ),
          Effect.asVoid,
        );
      }
      get.set(state, { _tag: "Applying", plan: command.plan });
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.provisioning.apply({
          connectionId: connection.connectionId,
          domain: connection.domain,
          planDigest: command.plan.digest,
        }),
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "Applied") {
              get.set(state, { _tag: "Complete", result });
              onAppliedRef.current?.(result);
            } else if (result._tag === "Partial") {
              get.set(state, { _tag: "Partial", result });
              onAppliedRef.current?.(result);
            } else {
              get.set(state, result);
            }
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            get.set(
              state,
              failureFromCause(cause, "provisioning.apply", "DNS provisioning failed"),
            ),
          ),
        ),
        Effect.asVoid,
      );
    });
    return { execute, state };
  }, [connection.connectionId, connection.domain, recordKey, runtime]);
  const state = useAtomValue(controller.state);
  const setState = useAtomSet(controller.state);
  const execute = useAtomSet(controller.execute);

  return {
    apply: () => {
      if (
        state._tag === "Review" &&
        !state.plan.operations.some((operation) => operation._tag === "Conflict")
      )
        execute(Command.Apply({ plan: state.plan }));
    },
    dismiss: () => setState({ _tag: "Idle" }),
    plan: () => execute(Command.Plan()),
    retry: () => execute(Command.Plan()),
    state,
  };
}

export interface FlowProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly connection: Transport.Connected;
  readonly onApplied?: (
    result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly showRecords?: boolean;
}

export function Flow({ connection, onApplied, records, showRecords = true, ...props }: FlowProps) {
  const controller = useController(connection, records, onApplied);
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const state = controller.state;
  const plan = state._tag === "Review" || state._tag === "Applying" ? state.plan : undefined;
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {showRecords ? <Records.Table records={records} /> : null}
          {state._tag === "Complete" ? (
            <p data-domainkit-part="flow-outcome" data-tone="success">
              {messages.recordsApplied}
            </p>
          ) : null}
          {state._tag === "Partial" ? (
            <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
              {messages.recordsPartiallyApplied}
            </p>
          ) : null}
          {state._tag === "Failure" || state._tag === "Stale" ? (
            <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
              {state.message}
            </p>
          ) : null}
          <BaseDialog.Root
            onOpenChange={(open) => {
              if (!open) controller.dismiss();
            }}
            open={plan !== undefined}
          >
            <BaseDialog.Trigger
              data-domainkit-part="plan-trigger"
              disabled={state._tag === "Planning" || state._tag === "Applying"}
              onClick={() => void controller.plan()}
            >
              {state._tag === "Planning" ? messages.planningDns : messages.reviewDns}
            </BaseDialog.Trigger>
            {plan === undefined ? null : (
              <BaseDialog.Portal container={portalContainer ?? undefined}>
                <BaseDialog.Backdrop data-domainkit-part="dialog-backdrop" />
                <BaseDialog.Popup
                  data-color-scheme={colorScheme}
                  data-domainkit-part="plan-dialog"
                  data-domainkit-root=""
                  style={themeStyle}
                >
                  <div data-domainkit-part="dialog-header">
                    <div data-domainkit-part="dialog-heading">
                      <BaseDialog.Title data-domainkit-part="dialog-title">
                        {messages.reviewDns}
                      </BaseDialog.Title>
                      <BaseDialog.Description data-domainkit-part="dialog-description">
                        {messages.planConsent}
                      </BaseDialog.Description>
                    </div>
                    <BaseDialog.Close
                      aria-label={messages.close}
                      data-domainkit-part="dialog-close"
                    >
                      ×
                    </BaseDialog.Close>
                  </div>
                  <div data-domainkit-part="dialog-body">
                    <OperationList plan={plan} />
                  </div>
                  <div data-domainkit-part="dialog-footer">
                    <BaseDialog.Close data-domainkit-part="dialog-cancel">
                      {messages.cancel}
                    </BaseDialog.Close>
                    <button
                      data-domainkit-part="plan-apply"
                      disabled={
                        state._tag === "Applying" ||
                        plan.operations.some((operation) => operation._tag === "Conflict")
                      }
                      onClick={() => void controller.apply()}
                      type="button"
                    >
                      {state._tag === "Applying" ? messages.applyingDns : messages.applyDns}
                    </button>
                  </div>
                </BaseDialog.Popup>
              </BaseDialog.Portal>
            )}
          </BaseDialog.Root>
          {state._tag === "Failure" || state._tag === "Stale" || state._tag === "Partial" ? (
            <button
              data-domainkit-part="provisioning-retry"
              onClick={() => void controller.retry()}
              type="button"
            >
              {messages.retry}
            </button>
          ) : null}
        </>
      ),
      "data-domainkit-part": "provisioning-flow",
      "data-state": state._tag,
    },
  );
}

export function OperationList({ plan }: { readonly plan: Transport.ProvisioningPlan }) {
  return (
    <ul data-domainkit-part="plan-operations">
      {plan.operations.map((operation) => (
        <li data-operation={operation._tag} key={operation.id}>
          <span data-domainkit-part="operation-kind">{operation._tag}</span>{" "}
          <strong data-domainkit-part="operation-type">{operation.record.type}</strong>{" "}
          <span data-domainkit-part="operation-record">
            <span data-domainkit-part="operation-name">{operation.record.name}</span>
            <code data-domainkit-part="operation-value">{operation.record.value}</code>
            {operation.record.priority === undefined ? null : (
              <span data-domainkit-part="operation-priority">
                Priority {operation.record.priority}
              </span>
            )}
            {operation._tag === "Conflict" ? (
              <span data-domainkit-part="operation-reason">{operation.reason}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
