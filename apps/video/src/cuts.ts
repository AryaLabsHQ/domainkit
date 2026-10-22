import type { Cut } from "./scene";

const beats = [
  { scene: "hook", duration: 9 },
  { scene: "reveal", duration: 7 },
  { scene: "connect", duration: 7 },
  { scene: "plan", duration: 9 },
  { scene: "approve", duration: 9 },
  { scene: "verify", duration: 6 },
  { scene: "boundary", duration: 8 },
  { scene: "cta", duration: 5 },
];
let start = 0;
export const hero: Cut = {
  id: "hero",
  width: 1920,
  height: 1080,
  music: true,
  shots: beats.map((beat) => {
    const shot = { ...beat, start };
    start += beat.duration;
    return shot;
  }),
};
export const stillIds = ["lifecycle", "semantics", "comparison", "host-boundary"];
