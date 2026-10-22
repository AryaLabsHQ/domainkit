import type { SceneMotion } from "../../scene";
import { arrive, draw, ease, lift, one, point, press, rise, swap } from "../motion-kit";

/** Pointer target: the centre of "Check again" in the bottom bar (right aligned, 84px tall). */
const CHECK_AGAIN = { x: 1220 + 130 - 9, y: 880 + 42 - 5.5 } as const;

/**
 * 0.2 title. 0.5 table. 1.0 rows check. 1.9 / 2.5 / 3.1 Noop, Create, Conflict. 3.4 the conflict
 * explains itself and the apply stays blocked. 6.4 Check again builds a separate plan.
 */
export const plan: SceneMotion = (tl, root) => {
  const cursor = one(root, "cursor");
  draw(tl, one(root, "header-rule"), 0.1, { duration: 0.6 });
  lift(tl, one(root, "line"), 0.2, { duration: 0.9 });
  tl.fromTo(
    one(root, "panel"),
    { autoAlpha: 0, y: 36 },
    { autoAlpha: 1, y: 0, duration: 0.8, ease: ease.out },
    0.5,
  );

  // Initial state: every row is checking; only the first digest and the blocked caption show.
  const wait = ["r1-wait", "r2-wait", "r3-wait"].map((name) => one(root, name));
  tl.set(
    [
      "r1-done",
      "r2-done",
      "r3-done",
      "r3-blocked",
      "r3-tint",
      "digest-2",
      "caption-2",
      "add-ready",
      "check-again",
      "r1-out-done",
      "r2-out-done",
      "r3-out-blocked",
      "r3-out-done",
    ].map((name) => one(root, name)),
    { autoAlpha: 0 },
    0,
  );
  tl.set(one(root, "caption-1"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "note"), { autoAlpha: 0 }, 0);
  tl.fromTo(
    wait,
    { autoAlpha: 0, x: -10 },
    { autoAlpha: 1, x: 0, duration: 0.4, stagger: 0.12, ease: ease.out },
    1.0,
  );

  swap(tl, wait[0], one(root, "r1-done"), 1.9, 0.3);
  swap(tl, wait[1], one(root, "r2-done"), 2.5, 0.3);
  swap(tl, wait[2], one(root, "r3-blocked"), 3.1, 0.3);
  // The semantic outcome lands with its status.
  rise(tl, one(root, "r1-out-done"), 1.9, { y: 8, duration: 0.3 });
  rise(tl, one(root, "r2-out-done"), 2.5, { y: 8, duration: 0.3 });
  rise(tl, one(root, "r3-out-blocked"), 3.1, { y: 8, duration: 0.3 });
  tl.fromTo(one(root, "r3-tint"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 3.1);

  // The conflict explains itself; the panel opens to hold it.
  tl.to(one(root, "panel"), { height: 552, duration: 0.5, ease: ease.inOut }, 3.5);
  rise(tl, one(root, "note"), 3.7, { y: 0, duration: 0.5 });
  rise(tl, one(root, "caption-1"), 4.0, { y: 12, duration: 0.5 });

  // Fix at the provider, check again: a separate plan with its own digest.
  rise(tl, one(root, "check-again"), 5.0, { y: 12, duration: 0.5 });
  arrive(tl, cursor, 1500, 1000, 5.2);
  point(tl, cursor, CHECK_AGAIN.x, CHECK_AGAIN.y, 5.3, 1.0);
  press(tl, cursor, 6.4);
  tl.to(one(root, "check-again"), { opacity: 0.6, duration: 0.15 }, 6.4);
  tl.to(one(root, "check-again"), { opacity: 1, duration: 0.3 }, 6.6);
  swap(tl, one(root, "r3-blocked"), one(root, "r3-done"), 6.6, 0.3);
  swap(tl, one(root, "r3-out-blocked"), one(root, "r3-out-done"), 6.6, 0.3);
  tl.to(one(root, "r3-tint"), { autoAlpha: 0, duration: 0.4 }, 6.6);
  tl.to(one(root, "note"), { autoAlpha: 0, duration: 0.25 }, 6.5);
  tl.to(one(root, "panel"), { height: 456, duration: 0.5, ease: ease.inOut }, 6.7);
  swap(tl, one(root, "digest-1"), one(root, "digest-2"), 6.7, 0.3);
  swap(tl, one(root, "caption-1"), one(root, "caption-2"), 6.7, 0.3);
  swap(tl, one(root, "add-blocked"), one(root, "add-ready"), 7.3, 0.3);
  tl.to(cursor, { autoAlpha: 0, duration: 0.4 }, 7.2);
};
