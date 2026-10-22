import type { SceneMotion } from "../../scene";
import { STILL_SETTLE } from "../motion-kit";

export const social: SceneMotion = (tl) => {
  tl.set({}, {}, STILL_SETTLE);
};
