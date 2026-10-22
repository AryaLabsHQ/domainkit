import type { SceneMotion } from "../../scene";
import { all, draw, ease, lift, one, rise } from "../motion-kit";

/** 0.2 frame draws. 0.8 mark resolves. 1.3 wordmark. 2.0 H1 lines. 3.3 rule. Holds to 7s. */
export const reveal: SceneMotion = (tl, root) => {
  draw(tl, [one(root, "frame-top"), one(root, "frame-bottom")], 0.2, { duration: 0.8 });
  draw(tl, [one(root, "frame-left"), one(root, "frame-right")], 0.2, { axis: "y", duration: 0.8 });
  tl.fromTo(
    one(root, "mark"),
    { clipPath: "inset(100% 0% 0% 0%)", scale: 0.92, transformOrigin: "50% 100%" },
    { clipPath: "inset(0% 0% 0% 0%)", scale: 1, duration: 0.9, ease: ease.soft },
    0.8,
  );
  lift(tl, one(root, "wordmark"), 1.3, { duration: 0.8 });
  const lines = all(root, "line");
  lift(tl, lines, 2.0, { duration: 0.95, stagger: 0.3 });
  draw(tl, one(root, "underline"), 3.3, { duration: 0.9 });
  draw(tl, one(root, "foot-rule"), 3.8, { duration: 0.9 });
  rise(tl, all(root, "foot"), 4.1, { y: 10, duration: 0.6, stagger: 0.1 });
  // A slow drift keeps the held frame alive.
  tl.fromTo(one(root, "h1"), { x: 0 }, { x: 16, duration: 4, ease: ease.linear }, 3);
};
