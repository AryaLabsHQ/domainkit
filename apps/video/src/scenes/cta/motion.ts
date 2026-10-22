import type { SceneMotion } from "../../scene";
import { draw, ease, lift, one, rise } from "../motion-kit";

/** 0.1 lockup. 0.7 command panel. 1.2-2.5 the command types. 3.0 the address. Holds to 5s. */
export const cta: SceneMotion = (tl, root) => {
  tl.fromTo(
    one(root, "mark"),
    { autoAlpha: 0, scale: 0.9, transformOrigin: "50% 50%" },
    { autoAlpha: 1, scale: 1, duration: 0.7, ease: ease.out },
    0.1,
  );
  lift(tl, one(root, "wordmark"), 0.3, { duration: 0.8 });
  rise(tl, one(root, "panel"), 0.7, { y: 30, duration: 0.8 });
  tl.fromTo(
    one(root, "command"),
    { clipPath: "inset(0 100% 0 0)" },
    { clipPath: "inset(0 0% 0 0)", duration: 1.3, ease: "steps(17)" },
    1.3,
  );
  // The caret appears once the command is typed, then blinks.
  const caret = one(root, "caret");
  tl.set(caret, { autoAlpha: 0 }, 0);
  tl.set(caret, { autoAlpha: 1 }, 2.6);
  tl.fromTo(
    caret,
    { opacity: 1 },
    { opacity: 0, duration: 0.001, repeat: 3, repeatDelay: 0.5, yoyo: true, ease: ease.linear },
    2.9,
  );
  lift(tl, one(root, "line"), 3.0, { duration: 0.9 });
  draw(tl, one(root, "underline"), 3.6, { duration: 0.8 });
  draw(tl, one(root, "foot-rule"), 4.0, { duration: 0.8 });
  rise(tl, one(root, "foot"), 3.6, { y: 8, duration: 0.5 });
};
