import type { SceneMotion } from "../../scene";
import { all, draw, lift, one, rise, STILL_SETTLE } from "../motion-kit";

/** A still: every station and join is in place by one second. */
export const lifecycle: SceneMotion = (tl, root) => {
  draw(tl, one(root, "header-rule"), 0, { duration: 0.4 });
  lift(tl, all(root, "line"), 0, { duration: 0.6, stagger: 0.08 });
  rise(tl, all(root, "station"), 0.05, { y: 16, duration: 0.45, stagger: 0.06 });
  draw(tl, all(root, "join"), 0.35, { duration: 0.3, stagger: 0.05 });
  draw(tl, all(root, "turn"), 0.55, { duration: 0.2, stagger: 0.1 });
  tl.set({}, {}, STILL_SETTLE);
};
