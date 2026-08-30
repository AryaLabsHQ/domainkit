import type { Transport } from "domainkit";
import type { ReactElement } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";

export type Operation =
  | Transport.ProvisioningPlan["operations"][number]
  | Transport.CleanupPlan["operations"][number];

type LeafState = Record<string, unknown>;

function leafPart<Tag extends keyof React.JSX.IntrinsicElements>(
  defaultTagName: Tag,
  part: string,
) {
  return function Leaf(props: PartProps<Tag, LeafState>): ReactElement {
    return usePart(defaultTagName, props, {}, { "data-domainkit-part": part });
  };
}

export const Kind = leafPart("span", "operation-kind");
export const Type = leafPart("strong", "operation-type");
export const Record = leafPart("span", "operation-record");
export const Name = leafPart("span", "operation-name");
export const Value = leafPart("code", "operation-value");
export const Priority = leafPart("span", "operation-priority");
export const Reason = leafPart("span", "operation-reason");

export interface ItemProps extends PartProps<"li", { readonly operation: Operation["_tag"] }> {
  readonly operation: Operation;
}

export function Item({ operation, ...props }: ItemProps) {
  return usePart(
    "li",
    props,
    { operation: operation._tag },
    {
      children: (
        <>
          <Kind>{operation._tag}</Kind> <Type>{operation.record.type}</Type>{" "}
          <Record>
            <Name>{operation.record.name}</Name>
            <Value>{operation.record.value}</Value>
            {operation.record.priority === undefined ? null : (
              <Priority>Priority {operation.record.priority}</Priority>
            )}
            {"reason" in operation ? <Reason>{operation.reason}</Reason> : null}
          </Record>
        </>
      ),
      "data-domainkit-part": "operation-item",
      "data-operation": operation._tag,
    },
  );
}

export interface RootProps extends PartProps<
  "ul",
  { readonly count: number; readonly lifecycle: Lifecycle }
> {
  readonly count?: number;
  readonly lifecycle: Lifecycle;
}

export type Lifecycle = "cleanup" | "provisioning";

export function Root({ count = 0, lifecycle, ...props }: RootProps) {
  return usePart(
    "ul",
    props,
    { count, lifecycle },
    {
      "data-domainkit-part":
        lifecycle === "provisioning" ? "plan-operations" : "cleanup-operations",
      "data-lifecycle": lifecycle,
    },
  );
}

export interface ListProps extends Omit<RootProps, "children" | "count"> {
  readonly operations: ReadonlyArray<Operation>;
}

export function List({ lifecycle, operations, ...props }: ListProps) {
  return (
    <Root count={operations.length} lifecycle={lifecycle} {...props}>
      {operations.map((operation) => (
        <Item key={operation.id} operation={operation} />
      ))}
    </Root>
  );
}
