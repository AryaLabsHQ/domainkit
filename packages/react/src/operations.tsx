import { DnsRecord, type Plan } from "domainkit";
import type { ReactElement } from "react";

import type { PartProps } from "./composition.tsx";
import { leafPart, usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { CopyValue } from "./records.tsx";

export const Kind = leafPart("span", "operation-kind");
export const Type = leafPart("strong", "operation-type");
export const Record = leafPart("span", "operation-record");
export const Name = leafPart("span", "operation-name");
export const Reason = leafPart("span", "operation-reason");

export interface ItemProps extends PartProps<"li", { readonly operation: Plan.Operation["_tag"] }> {
  readonly operation: Plan.Operation;
}

export function Item({ operation, ...props }: ItemProps): ReactElement {
  const { messages } = useDomainKit();
  return usePart(
    "li",
    props,
    { operation: operation._tag },
    {
      children: (
        <>
          <Kind>{messages.operation(operation)}</Kind>{" "}
          <Type>{messages.recordType(operation.record)}</Type>{" "}
          <Record>
            <Name>{operation.record.name}</Name>
            <CopyValue value={DnsRecord.data(operation.record)} />
          </Record>
          {operation._tag === "Conflict" ? (
            <Reason>{messages.conflictReason(operation.reason)}</Reason>
          ) : null}
        </>
      ),
      "data-domainkit-part": "operation-item",
      "data-operation": operation._tag,
    },
  );
}

export interface RootProps extends PartProps<
  "ul",
  { readonly count: number; readonly kind: Plan.Kind }
> {
  readonly count?: number;
  readonly kind: Plan.Kind;
}

export function Root({ count = 0, kind, ...props }: RootProps): ReactElement {
  return usePart(
    "ul",
    props,
    { count, kind },
    {
      "data-domainkit-part": kind === "provisioning" ? "plan-operations" : "cleanup-operations",
      "data-kind": kind,
    },
  );
}

export interface ListProps extends Omit<RootProps, "children" | "count" | "kind"> {
  readonly plan: Plan.Model;
}

/** Every operation the plan holds, in plan order, so a customer reviews exactly what will run. */
export function List({ plan, ...props }: ListProps): ReactElement {
  return (
    <Root count={plan.operations.length} kind={plan.kind} {...props}>
      {plan.operations.map((operation) => (
        <Item key={operation.id} operation={operation} />
      ))}
    </Root>
  );
}
