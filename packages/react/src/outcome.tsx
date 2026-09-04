/**
 * What a flow says when a step ends badly: media, title, description, and the action that follows.
 * Every flow's `Outcome` binds its controller to these parts, so a failure reads the same way in
 * the connect dialog, the review dialog, and the verification popover.
 *
 *   <Connect.Outcome controller={connection} />            the default composition
 *
 *   <Connect.Outcome controller={connection}>              a composition of your own
 *     <Outcome.Header>
 *       <Outcome.Media><MyIcon /></Outcome.Media>
 *       <Outcome.Title />
 *       <Outcome.Description />
 *     </Outcome.Header>
 *     <Outcome.Content />
 *   </Connect.Outcome>
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { useIcons } from "./icons.tsx";

/** How the outcome reads: a problem, a caution, or a step that went through. */
export type Tone = "danger" | "success" | "warning";

/** `card` is the panel a flow shows on its own; `inline` sits under a field or in a busy row. */
export type Layout = "card" | "inline";

/** What a flow resolved for the outcome its parts render. */
export interface Value {
  readonly tone: Tone;
  readonly layout: Layout;
  readonly title: string;
  readonly description: string;
  /** The retry the flow allows, or `null` when it allows none. */
  readonly retry: (() => void) | null;
  /** The part name the flow's retry carries, so a host's selectors keep working. */
  readonly retryPart: string;
}

const fallback: Value = {
  description: "",
  layout: "card",
  retry: null,
  retryPart: "flow-retry",
  title: "",
  tone: "danger",
};

const Context = createContext<Value | null>(null);

/** What the surrounding flow resolved, for a part of your own inside `X.Outcome`. */
export function useOutcome(): Value {
  return useContext(Context) ?? fallback;
}

/** Binds a resolved outcome to the parts below it. Flows render this; hosts rarely do. */
export function Provider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: Value;
}): ReactElement {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export interface State extends Record<string, unknown> {
  readonly tone: Tone;
  readonly layout: Layout;
}

export interface RootProps extends PartProps<"div", State> {
  readonly tone?: Tone;
  readonly layout?: Layout;
}

/** The outcome itself. It announces, so a customer reading with assistive tech hears it. */
export function Root({ layout, tone, ...props }: RootProps): ReactElement {
  const value = useOutcome();
  const resolved: State = { layout: layout ?? value.layout, tone: tone ?? value.tone };
  return usePart("div", props, resolved, {
    "data-domainkit-part": "outcome",
    "data-layout": resolved.layout,
    "data-tone": resolved.tone,
    role: "alert",
  });
}

export interface HeaderProps extends PartProps<"div", State> {}

/** Media, title, and description together, so the action below them can move on its own. */
export function Header(props: HeaderProps): ReactElement {
  const { layout, tone } = useOutcome();
  return usePart("div", props, { layout, tone }, { "data-domainkit-part": "outcome-header" });
}

export interface MediaProps extends PartProps<"div", State> {
  /** `icon` frames the glyph the way shadcn's `EmptyMedia` does; `default` draws it bare. */
  readonly variant?: "default" | "icon";
}

/** The glyph for the tone. Children replace it; `icons` on `DomainKit.Root` replaces the set. */
export function Media({ variant = "icon", ...props }: MediaProps): ReactElement {
  const { layout, tone } = useOutcome();
  const icons = useIcons();
  const glyph =
    tone === "success" ? icons.success : tone === "warning" ? icons.warning : icons.failure;
  return usePart(
    "div",
    props,
    { layout, tone },
    {
      "aria-hidden": "true",
      children: glyph,
      "data-domainkit-part": "outcome-media",
      "data-variant": variant,
    },
  );
}

export interface TitleProps extends PartProps<"div", State> {}

/** The heading from the catalog. Children win, for a host that words it itself. */
export function Title(props: TitleProps): ReactElement {
  const { layout, title, tone } = useOutcome();
  return usePart(
    "div",
    props,
    { layout, tone },
    { children: title, "data-domainkit-part": "outcome-title" },
  );
}

export interface DescriptionProps extends PartProps<"p", State> {}

/** What to do about it, from the catalog. */
export function Description(props: DescriptionProps): ReactElement {
  const { description, layout, tone } = useOutcome();
  return usePart(
    "p",
    props,
    { layout, tone },
    { children: description, "data-domainkit-part": "outcome-description" },
  );
}

export interface ContentProps extends PartProps<"div", State> {}

/**
 * The actions under the header. Without children it is the flow's retry, and a flow that allows
 * none renders nothing: read-only hides every control that would start a write again.
 */
export function Content(props: ContentProps): ReactElement | null {
  const { messages } = useDomainKit();
  const { layout, retry, retryPart, tone } = useOutcome();
  const element = usePart(
    "div",
    props,
    { layout, tone },
    {
      children:
        retry === null ? null : (
          <button data-domainkit-part={retryPart} onClick={retry} type="button">
            {messages.retry}
          </button>
        ),
      "data-domainkit-part": "outcome-content",
    },
  );
  return retry === null && props.children === undefined ? null : element;
}

/** Media, title, and description in a header, then the action. What `X.Outcome` renders alone. */
export function Composition(): ReactElement {
  return (
    <>
      <Header>
        <Media />
        <Title />
        <Description />
      </Header>
      <Content />
    </>
  );
}
