import type { CSSProperties, ReactNode } from "react";

/**
 * Field Manual primitives at frame scale (1920x1080, content inside the 1920x1008 safe area). They
 * follow the anatomy of the registry blocks (`apps/docs/registry`): a rounded hairline panel, a
 * status badge with a dot, mono records. Styling lives in `src/styles.css`; `data-a="<name>"`
 * marks what a motion animates.
 */

/** The DomainKit mark, from `apps/docs/public/brand/domainkit-mark.svg`, in the current color. */
const MARK_PATH =
  "M21 3h4a2 2 0 0 1 2 2v21a2 2 0 0 1-2 2H11a7 7 0 0 1-7-7v-4a7 7 0 0 1 7-7h10V3ZM9 19l6 6 10-10-3-3-7 7-3-3-3 3Z";

export function Mark({ size, a, color }: { size: number; a?: string; color?: string }) {
  return (
    <svg
      data-a={a}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={{ display: "block", color: color ?? "var(--dk-ink)", flexShrink: 0 }}
    >
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

export function Scene({ children }: { children: ReactNode }) {
  return <div className="dk-scene">{children}</div>;
}

/** The page header: brand left, the page's name right, a hairline beneath and a blue tick on it. */
export function Header({ label }: { label: string }) {
  return (
    <>
      <header className="dk-header" data-a="header">
        <span className="dk-brand">
          <Mark size={34} />
          DomainKit
        </span>
        <span className="dk-kicker">{label}</span>
      </header>
      <i className="dk-header-rule" data-a="header-rule" />
    </>
  );
}

export function Kicker({
  children,
  a,
  blue,
  style,
}: {
  children: ReactNode;
  a?: string;
  blue?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={blue ? "dk-kicker dk-kicker--blue" : "dk-kicker"} style={style}>
      {children}
    </span>
  );
}

/** One line of display type that rises out of a clip. */
export function Line({
  children,
  a = "line",
  inline,
}: {
  children: ReactNode;
  a?: string;
  inline?: boolean;
}) {
  return (
    <span className={inline ? "dk-mask-inline" : "dk-mask"}>
      <span data-a={a}>{children}</span>
    </span>
  );
}

export type Tone = "success" | "warning" | "danger" | "neutral" | "action";

export function Badge({
  tone,
  children,
  a,
  style,
}: {
  tone: Tone;
  children: ReactNode;
  a?: string;
  style?: CSSProperties;
}) {
  return (
    <span data-a={a} className={`dk-badge dk-badge--${tone}`} style={style}>
      <i />
      {children}
    </span>
  );
}

export function Check({
  size = 28,
  a,
  stroke = 3,
}: {
  size?: number;
  a?: string;
  stroke?: number;
}) {
  return (
    <svg
      data-a={a}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M4 12.5l5 5L20 6.5"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Lock({ size = 28, a }: { size?: number; a?: string }) {
  return (
    <svg
      data-a={a}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect x="5" y="10.5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Arrow({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M4 12h15M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Cloudflare and Vercel, from the docs site's `ProviderLogo` (svgl.app sources). */
export function ProviderLogo({
  provider,
  size = 56,
}: {
  provider: "cloudflare" | "vercel";
  size?: number;
}) {
  if (provider === "cloudflare") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 256 116"
        preserveAspectRatio="xMidYMid"
        style={{ display: "block", flexShrink: 0 }}
      >
        <path
          d="m202.357 49.394-5.311-2.124C172.085 103.434 72.786 69.289 66.81 85.997c-.996 11.286 54.227 2.146 93.706 4.059 12.039.583 18.076 9.671 12.964 24.484l10.069.031c11.615-36.209 48.683-17.73 50.232-29.68-2.545-7.857-42.601 0-31.425-35.497Z"
          fill="#FFF"
        />
        <path
          d="M176.332 108.348c1.593-5.31 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.31-11.154-5.842L71.17 87.634c-.531 0-1.062-.53-1.593-.53-.531-.532-.531-1.063 0-1.594.531-1.062 1.062-1.594 2.124-1.594l92.946-1.062c11.154-.53 22.839-9.56 27.087-20.182l5.312-13.809c0-.532.531-1.063 0-1.594C191.203 20.182 166.772 0 138.091 0 111.535 0 88.697 16.995 80.73 40.896c-5.311-3.718-11.684-5.843-19.12-5.31-12.747 1.061-22.838 11.683-24.432 24.43-.531 3.187 0 6.374.532 9.56C16.996 70.107 0 87.103 0 108.348c0 2.124 0 3.718.531 5.842 0 1.063 1.062 1.594 1.594 1.594h170.489c1.062 0 2.125-.53 2.125-1.594l1.593-5.842Z"
          fill="#F4811F"
        />
        <path
          d="M205.544 48.863h-2.656c-.531 0-1.062.53-1.593 1.062l-3.718 12.747c-1.593 5.31-1.062 10.623 1.594 13.809 2.655 3.187 6.373 5.31 11.153 5.843l19.652 1.062c.53 0 1.062.53 1.593.53.53.532.53 1.063 0 1.594-.531 1.063-1.062 1.594-2.125 1.594l-20.182 1.062c-11.154.53-22.838 9.56-27.087 20.182l-1.063 4.78c-.531.532 0 1.594 1.063 1.594h70.108c1.062 0 1.593-.531 1.593-1.593 1.062-4.25 2.124-9.03 2.124-13.81 0-27.618-22.838-50.456-50.456-50.456"
          fill="#FAAD3F"
        />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 222"
      preserveAspectRatio="xMidYMid"
      style={{ display: "block", flexShrink: 0, color: "var(--dk-ink)" }}
    >
      <path d="m128 0 128 221.705H0z" fill="currentColor" />
    </svg>
  );
}

/** A pointer for the demonstrations. The motion places it with `x` and `y` from the top left. */
export function Cursor({ a = "cursor" }: { a?: string }) {
  return (
    <svg data-a={a} className="dk-cursor" viewBox="0 0 44 44" fill="none">
      <path
        d="M9 5.5v28.4l7.6-7.3 5.2 11.9 6.4-2.8-5.2-11.7H31L9 5.5Z"
        fill="#0b1015"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
