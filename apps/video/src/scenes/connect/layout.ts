/** The dialog's geometry in scene coordinates. */
export const DIALOG = { left: 960, top: 190, width: 864, height: 720 } as const;
export const ROW = { left: 44, top: 220, height: 140, gap: 24 } as const;

const TIP = { x: 9, y: 5.5 } as const;

/** The pointer's top left for its tip to land on the centre of provider row `index`. */
export function rowTarget(index: number): { x: number; y: number } {
  const y = DIALOG.top + ROW.top + index * (ROW.height + ROW.gap) + ROW.height / 2;
  return { x: DIALOG.left + DIALOG.width / 2 - TIP.x, y: y - TIP.y };
}

export const start = { x: 1500, y: 960 } as const;
