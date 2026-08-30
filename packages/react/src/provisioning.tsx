import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useCallback } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Records from "./records.tsx";
import * as RequestState from "./request-state.ts";
import type { ApplyResult, Connected, DnsRecord, Failure, ProvisioningPlan } from "./transport.ts";

export type State =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Planning" }
  | { readonly _tag: "Review"; readonly plan: ProvisioningPlan }
  | { readonly _tag: "Applying"; readonly plan: ProvisioningPlan }
  | {
      readonly _tag: "Complete";
      readonly result: Extract<ApplyResult, { readonly _tag: "Applied" }>;
    }
  | {
      readonly _tag: "Partial";
      readonly result: Extract<ApplyResult, { readonly _tag: "Partial" }>;
    }
  | { readonly _tag: "Stale"; readonly message: string }
  | Failure;

export interface Controller {
  readonly apply: () => Promise<void>;
  readonly dismiss: () => void;
  readonly plan: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly state: State;
}

const failure = (cause: unknown): Failure => ({
  _tag: "Failure",
  message: cause instanceof Error ? cause.message : "DNS provisioning failed",
  retry: "safe",
});

export function useController(
  connection: Connected,
  records: ReadonlyArray<DnsRecord>,
  onApplied?: (result: Extract<ApplyResult, { readonly _tag: "Applied" | "Partial" }>) => void,
): Controller {
  const { transport } = useDomainKit();
  const identity = `${connection.connectionId}:${connection.domain}:${RequestState.recordsIdentity(records)}`;
  const requestState = RequestState.useController<State>(identity, { _tag: "Idle" });
  const state = requestState.state;

  const plan = useCallback(async () => {
    const request = requestState.begin({ _tag: "Planning" });
    try {
      const result = await transport.provisioning.plan({
        connectionId: connection.connectionId,
        domain: connection.domain,
        records,
      });
      requestState.commit(
        request,
        result._tag === "Plan" ? { _tag: "Review", plan: result } : result,
      );
    } catch (cause) {
      requestState.commit(request, failure(cause));
    }
  }, [connection.connectionId, connection.domain, records, requestState, transport]);

  const apply = useCallback(async () => {
    if (state._tag !== "Review") return;
    const reviewedPlan = state.plan;
    if (reviewedPlan.operations.some((operation) => operation._tag === "Conflict")) return;
    const request = requestState.begin({ _tag: "Applying", plan: reviewedPlan });
    try {
      const result = await transport.provisioning.apply({
        connectionId: connection.connectionId,
        domain: connection.domain,
        planDigest: reviewedPlan.digest,
      });
      if (result._tag === "Applied") {
        if (requestState.commit(request, { _tag: "Complete", result })) onApplied?.(result);
      } else if (result._tag === "Partial") {
        if (requestState.commit(request, { _tag: "Partial", result })) onApplied?.(result);
      } else {
        requestState.commit(request, result);
      }
    } catch (cause) {
      requestState.commit(request, failure(cause));
    }
  }, [connection.connectionId, connection.domain, onApplied, requestState, state, transport]);

  return {
    apply,
    dismiss: () => requestState.reset({ _tag: "Idle" }),
    plan,
    retry: plan,
    state,
  };
}

export interface FlowProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly connection: Connected;
  readonly onApplied?: (
    result: Extract<ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void;
  readonly records: ReadonlyArray<DnsRecord>;
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
                    <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
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

export function OperationList({ plan }: { readonly plan: ProvisioningPlan }) {
  return (
    <ul data-domainkit-part="plan-operations">
      {plan.operations.map((operation) => (
        <li data-operation={operation._tag} key={operation.id}>
          <span data-domainkit-part="operation-kind">{operation._tag}</span>{" "}
          <strong>{operation.record.type}</strong>{" "}
          <span data-domainkit-part="operation-record">
            {operation.record.name}
            {operation._tag === "Conflict" ? ` ${operation.reason}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
