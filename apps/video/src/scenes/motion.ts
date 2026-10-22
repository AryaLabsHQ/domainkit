import type { SceneMotion } from "../scene";
import { approve } from "./approve/motion";
import { boundary } from "./boundary/motion";
import { comparison } from "./comparison/motion";
import { connect } from "./connect/motion";
import { cta } from "./cta/motion";
import { hook } from "./hook/motion";
import { hostBoundary } from "./host-boundary/motion";
import { lifecycle } from "./lifecycle/motion";
import { plan } from "./plan/motion";
import { reveal } from "./reveal/motion";
import { semantics } from "./semantics/motion";
import { verify } from "./verify/motion";

/** Runtime entry: every scene's motion, keyed by scene id. `markup.tsx` renders their markup. */
export const motions: Record<string, SceneMotion> = {
  hook,
  reveal,
  connect,
  plan,
  approve,
  verify,
  boundary,
  cta,
  lifecycle,
  semantics,
  comparison,
  "host-boundary": hostBoundary,
};
