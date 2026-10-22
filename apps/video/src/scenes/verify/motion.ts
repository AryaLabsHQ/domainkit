import type { SceneMotion } from "../../scene";
import { draw, drop, lift, one, rise, swap } from "../motion-kit";

/** 0.2 headline. 0.6 table. 1.2 provider readback. 2.2-3.2 public DNS finds each record. 3.8 verified. */
export const verify: SceneMotion = (tl, root) => {
  draw(tl, one(root, "header-rule"), 0.1, { duration: 0.6 });
  tl.set(one(root, "head-2"), { autoAlpha: 0, yPercent: 112 }, 0);
  lift(tl, one(root, "head-1"), 0.2, { duration: 0.9 });
  rise(tl, one(root, "table"), 0.5, { y: 36, duration: 0.8 });

  tl.set(
    [0, 1, 2]
      .flatMap((i) => [one(root, `provider-${i}-done`), one(root, `public-${i}-done`)])
      .concat([one(root, "overall-2"), one(root, "summary")]),
    { autoAlpha: 0 },
    0,
  );
  // Provider readback answers first.
  for (const i of [0, 1, 2])
    swap(tl, one(root, `provider-${i}-wait`), one(root, `provider-${i}-done`), 1.3 + i * 0.2, 0.25);
  // Public DNS is a separate observation and takes longer.
  for (const i of [0, 1, 2])
    swap(tl, one(root, `public-${i}-wait`), one(root, `public-${i}-done`), 2.4 + i * 0.5, 0.3);
  drop(tl, one(root, "head-1"), 3.8);
  lift(tl, one(root, "head-2"), 3.9, { duration: 0.9 });
  swap(tl, one(root, "overall-1"), one(root, "overall-2"), 3.9, 0.3);
  rise(tl, one(root, "summary"), 4.4, { y: 12, duration: 0.6 });
};
