import type { SceneMotion } from "../../scene";
import { all, draw, lift, one, rise, STILL_SETTLE } from "../motion-kit";

export const semantics: SceneMotion = (tl, root) => {
  draw(tl, one(root, "header-rule"), 0, { duration: 0.4 });
  lift(tl, one(root, "line"), 0, { duration: 0.6 });
  rise(tl, one(root, "lede"), 0.15, { y: 10, duration: 0.4 });
  rise(tl, all(root, "column"), 0.2, { y: 24, duration: 0.5, stagger: 0.1 });
  rise(tl, all(root, "tag"), 0.55, { y: 8, duration: 0.3, stagger: 0.06 });
  tl.set({}, {}, STILL_SETTLE);
};
