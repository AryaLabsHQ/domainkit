import type { SceneMotion } from "../../scene";
import { all, draw, lift, one, rise, STILL_SETTLE } from "../motion-kit";

export const hostBoundary: SceneMotion = (tl, root) => {
  draw(tl, one(root, "header-rule"), 0, { duration: 0.4 });
  lift(tl, all(root, "line"), 0, { duration: 0.6, stagger: 0.08 });
  rise(tl, one(root, "left-kicker"), 0.1, { y: 8, duration: 0.3 });
  rise(tl, all(root, "owned"), 0.15, { y: 12, duration: 0.4, stagger: 0.05 });
  rise(tl, one(root, "engine"), 0.25, { y: 20, duration: 0.5 });
  rise(tl, all(root, "does"), 0.5, { y: 8, duration: 0.3, stagger: 0.07 });
  tl.set({}, {}, STILL_SETTLE);
};
