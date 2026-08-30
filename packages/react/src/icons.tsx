import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Icons = {
  readonly copied: ReactNode;
  readonly copy: ReactNode;
  readonly download: ReactNode;
};

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
} as const satisfies Icons;

const IconsContext = createContext<Icons>(defaultIcons);

export function IconsProvider({
  children,
  icons,
}: {
  readonly children: ReactNode;
  readonly icons?: Partial<Icons>;
}) {
  const value = useMemo<Icons>(
    () => ({
      copied: icons?.copied ?? defaultIcons.copied,
      copy: icons?.copy ?? defaultIcons.copy,
      download: icons?.download ?? defaultIcons.download,
    }),
    [icons],
  );
  return <IconsContext.Provider value={value}>{children}</IconsContext.Provider>;
}

export function useIcons(): Icons {
  return useContext(IconsContext);
}
