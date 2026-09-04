import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Every glyph the package draws, in one place. Parts read them from context; none of them takes
 * an icon prop of its own, so a host swaps the whole set once on `DomainKit.Root`.
 */
export interface Icons {
  /** Points at what a control opens: the provider menu's own marker. */
  readonly chevron: ReactNode;
  readonly close: ReactNode;
  readonly copied: ReactNode;
  readonly copy: ReactNode;
  readonly download: ReactNode;
  readonly external: ReactNode;
  readonly failure: ReactNode;
  readonly pending: ReactNode;
  readonly success: ReactNode;
  readonly warning: ReactNode;
}

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

export const defaultIcons = {
  chevron: (
    <Glyph>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  ),
  close: (
    <Glyph>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  ),
  copied: (
    <Glyph>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  ),
  copy: (
    <Glyph>
      <rect height="14" rx="2" width="14" x="8" y="8" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Glyph>
  ),
  download: (
    <Glyph>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Glyph>
  ),
  external: (
    <Glyph>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </Glyph>
  ),
  failure: (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9 9 15" />
      <path d="m9 9 6 6" />
    </Glyph>
  ),
  pending: (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Glyph>
  ),
  success: (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Glyph>
  ),
  warning: (
    <Glyph>
      <path d="M10.3 3.9 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  ),
} as const satisfies Icons;

const IconsContext = createContext<Icons>(defaultIcons);

export function IconsProvider({
  children,
  icons,
}: {
  readonly children: ReactNode;
  readonly icons?: Partial<Icons>;
}) {
  const value = useMemo<Icons>(() => ({ ...defaultIcons, ...icons }), [icons]);
  return <IconsContext.Provider value={value}>{children}</IconsContext.Provider>;
}

export function useIcons(): Icons {
  return useContext(IconsContext);
}
