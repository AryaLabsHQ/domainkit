import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useCallback, useState } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Records from "./records.tsx";
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
  const [state, setState] = useState<State>({ _tag: "Idle" });

  const plan = useCallback(async () => {
    setState({ _tag: "Planning" });
    try {
      const result = await transport.provisioning.plan({
        connectionId: connection.connectionId,
        domain: connection.domain,
        records,
      });
      setState(result._tag === "Plan" ? { _tag: "Review", plan: result } : result);
    } catch (cause) {
      setState(failure(cause));
    }
  }, [connection.connectionId, connection.domain, records, transport]);

  const apply = useCallback(async () => {
    if (state._tag !== "Review") return;
    const reviewedPlan = state.plan;
    if (reviewedPlan.operations.some((operation) => operation._tag === "Conflict")) return;
    setState({ _tag: "Applying", plan: reviewedPlan });
    try {
      const result = await transport.provisioning.apply({
        connectionId: connection.connectionId,
        domain: connection.domain,
        planDigest: reviewedPlan.digest,
      });
      if (result._tag === "Applied") {
        setState({ _tag: "Complete", result });
        onApplied?.(result);
      } else if (result._tag === "Partial") {
        setState({ _tag: "Partial", result });
        onApplied?.(result);
      } else {
        setState(result);
      }
    } catch (cause) {
      setState(failure(cause));
    }
  }, [connection.connectionId, connection.domain, onApplied, state, transport]);

  return { apply, dismiss: () => setState({ _tag: "Idle" }), plan, retry: plan, state };
}

export interface FlowProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly connection: Connected;
  readonly onApplied?: (
    result: Extract<ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => void;
  readonly records: ReadonlyArray<DnsRecord>;
}

export function Flow({ connection, onApplied, records, ...props }: FlowProps) {
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
          <Records.Table records={records} />
          {state._tag === "Complete" ? <p>{messages.recordsApplied}</p> : null}
          {state._tag === "Partial" ? <p role="alert">{messages.recordsPartiallyApplied}</p> : null}
          {state._tag === "Failure" || state._tag === "Stale" ? (
            <p role="alert">{state.message}</p>
          ) : null}
          <button
            data-domainkit-part="plan-trigger"
            disabled={state._tag === "Planning" || state._tag === "Applying"}
            onClick={() => void controller.plan()}
            type="button"
          >
            {state._tag === "Planning" ? messages.planningDns : messages.reviewDns}
          </button>
          <BaseDialog.Root
            onOpenChange={(open) => {
              if (!open) controller.dismiss();
            }}
            open={plan !== undefined}
          >
            {plan === undefined ? null : (
              <BaseDialog.Portal container={portalContainer ?? undefined}>
                <BaseDialog.Backdrop data-domainkit-part="dialog-backdrop" />
                <BaseDialog.Popup
                  data-color-scheme={colorScheme}
                  data-domainkit-part="plan-dialog"
                  data-domainkit-root=""
                  style={themeStyle}
                >
                  <BaseDialog.Title>{messages.reviewDns}</BaseDialog.Title>
                  <BaseDialog.Description>{messages.planConsent}</BaseDialog.Description>
                  <OperationList plan={plan} />
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
                  <BaseDialog.Close data-domainkit-part="dialog-cancel">
                    {messages.cancel}
                  </BaseDialog.Close>
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
          <strong>{operation._tag}</strong> {operation.record.type} {operation.record.name}{" "}
          {operation._tag === "Conflict" ? `— ${operation.reason}` : ""}
        </li>
      ))}
    </ul>
  );
}
