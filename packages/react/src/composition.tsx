import { useRender } from "@base-ui/react/use-render";
import type { CSSProperties, ElementType, ReactElement } from "react";

export type ClassName<State> = string | ((state: State) => string | undefined);
export type Style<State> = CSSProperties | ((state: State) => CSSProperties | undefined);

export type PartProps<Tag extends ElementType, State extends Record<string, unknown>> = Omit<
  useRender.ElementProps<Tag>,
  "className" | "style"
> & {
  readonly className?: ClassName<State>;
  readonly render?: useRender.RenderProp<State>;
  readonly style?: Style<State>;
};

export function usePart<
  Tag extends keyof React.JSX.IntrinsicElements,
  State extends Record<string, unknown>,
>(
  defaultTagName: Tag,
  componentProps: PartProps<Tag, State>,
  state: State,
  internalProps: Record<string, unknown>,
): ReactElement {
  const { className, render, style, ...externalProps } = componentProps;
  const parameters: useRender.Parameters<State, Element, undefined> & {
    readonly className?: ClassName<State>;
    readonly style?: Style<State>;
  } = {
    ...(className === undefined ? {} : { className }),
    defaultTagName,
    props: [externalProps, internalProps] as unknown as Record<string, unknown>,
    ...(render === undefined ? {} : { render }),
    state,
    ...(style === undefined ? {} : { style }),
  };
  return useRender(parameters);
}
