import type { SceneMarkup } from "../scene";
import { approve } from "./approve/markup";
import { boundary } from "./boundary/markup";
import { comparison } from "./comparison/markup";
import { connect } from "./connect/markup";
import { cta } from "./cta/markup";
import { hook } from "./hook/markup";
import { hostBoundary } from "./host-boundary/markup";
import { lifecycle } from "./lifecycle/markup";
import { plan } from "./plan/markup";
import { reveal } from "./reveal/markup";
import { semantics } from "./semantics/markup";
import { social } from "./social/markup";
import { verify } from "./verify/markup";

/** Build-time entry: every scene's markup, keyed by scene id. `motion.ts` holds their motion. */
export const markups: Record<string, SceneMarkup> = {
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
  social,
  comparison,
  "host-boundary": hostBoundary,
};
