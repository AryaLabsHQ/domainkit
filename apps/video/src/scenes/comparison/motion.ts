import type { SceneMotion } from "../../scene";
import { all, draw, lift, one, rise, STILL_SETTLE } from "../motion-kit";

export const comparison: SceneMotion = (tl, root) => {
  draw(tl, one(root, "header-rule"), 0, { duration: 0.4 });
  lift(tl, one(root, "line"), 0, { duration: 0.6 });
  draw(tl, one(root, "divider"), 0.1, { axis: "y", duration: 0.5 });
  rise(tl, all(root, "side"), 0.15, { y: 20, duration: 0.5, stagger: 0.1 });
  rise(tl, all(root, "step"), 0.3, { y: 12, duration: 0.4, stagger: 0.07 });
  tl.set({}, {}, STILL_SETTLE);
};
