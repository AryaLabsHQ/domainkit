/** The approve button's centre, for the pointer. The digest card sits at (1184, 290). */
export const CARD = { left: 1184, top: 290, width: 640, height: 310 } as const;
export const BUTTON = { left: 30, top: 196, width: 580, height: 84 } as const;

export const target = {
  x: CARD.left + BUTTON.left + BUTTON.width / 2 - 9,
  y: CARD.top + BUTTON.top + BUTTON.height / 2 - 5.5,
} as const;
