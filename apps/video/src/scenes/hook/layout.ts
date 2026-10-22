/** The browser window's geometry in scene coordinates, so the pointer lands exactly on its targets. */
export const WINDOW = { left: 920, top: 150, width: 880, height: 780, tabs: 64 } as const;

/** Tip of the pointer inside its 44px box. */
const TIP = { x: 9, y: 5.5 } as const;

/** Where the pointer's top left goes for its tip to land on a point of the window's content. */
export function aim(x: number, y: number): { x: number; y: number } {
  return { x: WINDOW.left + x - TIP.x, y: WINDOW.top + y - TIP.y };
}

/** Targets, in window coordinates. */
export const copyButton = aim(784, WINDOW.tabs + 290);
export const valueText = aim(250, WINDOW.tabs + 290);
export const secondTab = aim(448, 38);
export const targetField = aim(220, WINDOW.tabs + 508);
export const saveButton = aim(122, WINDOW.tabs + 628);
export const start = { x: 1760, y: 990 } as const;

export const rows = [
  { type: "CNAME", name: "help.example.com", value: "domains.yourapp.com" },
  { type: "TXT", name: "_verify.help.example.com", value: "yourapp-verify=7f3a9c21" },
  { type: "TXT", name: "example.com", value: "v=spf1 include:_spf.yourapp.com ~all" },
] as const;

export const ROW_TOP = 220;
export const ROW_HEIGHT = 140;
