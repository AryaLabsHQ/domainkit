"use client";

import { Connect, DomainKit, type Domain } from "@domainkit/react";
import { Plan, Receipt } from "domainkit";
import type { ComponentProps } from "react";

import { Outcome } from "@/components/domainkit/outcome";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PlanActionProps extends Omit<ComponentProps<"div">, "children"> {
  readonly flow: Domain.Flow;
}

/**
 * The one press a plan needs: it names what it will add, authorizes the digest, and applies it in
 * the same action. Where a conflict blocks part of a plan it approves the rest by id, because
 * naming a blocked operation in an approval is refused. Where every operation is blocked it says
 * what to fix instead, and once an apply has landed it says how many records it added.
 */
export function PlanAction({ className, flow, ...props }: PlanActionProps) {
  const messages = DomainKit.useMessages();
  const state = flow.provisioning.state;
  const plan = flow.plan;
  const running = state._tag === "Approving" || state._tag === "Applying";
  // Only a create or a delete is approvable: a conflict blocks, and a record already in place is
  // nothing to write.
  const writes = plan === null ? [] : Plan.writes(plan);
  const conflicts = plan === null ? [] : Plan.conflicts(plan);
  const blocked = plan !== null && writes.length === 0 && conflicts.length > 0;
  const applied = flow.connection.receipt;
  const failure = state._tag === "Failure" ? state.error : null;

  if (flow.state.readOnly) return null;
  if (plan === null && !running && failure === null) {
    // Nothing is pending, so the row reports what the last apply proved it added.
    return applied === null ? null : (
      <span
        className={cn("text-sm text-muted-foreground", className)}
        data-slot="plan-action"
        {...props}
      >
        {messages.recordsAdded(Receipt.applied(applied).length)}
      </span>
    );
  }
  return (
    <div
      className={cn("flex flex-col items-end gap-2", className)}
      data-slot="plan-action"
      {...props}
    >
      {blocked ? (
        <p className="text-sm text-muted-foreground">{messages.everyRecordConflicts}</p>
      ) : writes.length === 0 && !running ? null : (
        <Button
          disabled={running || writes.length === 0}
          onClick={() =>
            // Naming the ids is what leaves a conflict out; approving the whole plan would not.
            flow.provisioning.approve(
              writes.length === plan?.operations.length
                ? undefined
                : writes.map((operation) => operation.id),
            )
          }
          type="button"
        >
          {running ? messages.applying : messages.addRecords(writes.length)}
        </Button>
      )}
      <Outcome
        context={{
          domain: flow.domain,
          ...(flow.state.provider === null
            ? {}
            : { provider: Connect.displayName(flow.connection, flow.state.provider) }),
        }}
        error={failure}
        layout="inline"
        onRetry={flow.provisioning.retry}
      />
    </div>
  );
}
