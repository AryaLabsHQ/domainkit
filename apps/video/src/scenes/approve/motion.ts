import type { SceneMotion } from "../../scene";
import { all, arrive, draw, drop, ease, lift, one, point, press, rise, swap } from "../motion-kit";
import { target } from "./layout";

/**
 * 0.0 plan and digest. 2.3 the pointer approves that digest. 3.0 only it applies: rows add. 5.2
 * the receipt lands carrying the digest. Holds to 9s.
 */
export const approve: SceneMotion = (tl, root) => {
  const cursor = one(root, "cursor");
  const captions = all(root, "caption");
  const [first, second, third] = captions;
  if (first === undefined || second === undefined || third === undefined)
    throw new Error("approve expects three captions");

  draw(tl, one(root, "header-rule"), 0.1, { duration: 0.6 });
  tl.set([second, third], { autoAlpha: 0, yPercent: 112 }, 0);
  lift(tl, first, 0.2, { duration: 0.9 });
  rise(tl, one(root, "table"), 0.35, { y: 36, duration: 0.8 });
  rise(tl, one(root, "digest-card"), 0.6, { y: 36, duration: 0.8 });

  tl.set(
    [
      "card-ring",
      "digest-kicker-2",
      "approved",
      "tie",
      "progress-done",
      "receipt",
      "progress-label",
      "progress",
      "track",
    ].map((name) => one(root, name)),
    { autoAlpha: 0 },
    0,
  );
  for (const index of [0, 1]) {
    tl.set(
      [one(root, `state-${index}-busy`), one(root, `state-${index}-done`)],
      { autoAlpha: 0 },
      0,
    );
  }

  // Approve the exact digest.
  arrive(tl, cursor, 1500, 1000, 1.2);
  point(tl, cursor, target.x, target.y, 1.3, 1.0);
  press(tl, cursor, 2.4);
  swap(tl, one(root, "approve"), one(root, "approved"), 2.5, 0.25);
  swap(tl, one(root, "digest-kicker-1"), one(root, "digest-kicker-2"), 2.5, 0.25);
  tl.fromTo(one(root, "card-ring"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 2.5);
  tl.to(cursor, { autoAlpha: 0, duration: 0.3 }, 2.9);

  // Apply only that digest.
  drop(tl, first, 3.2);
  lift(tl, second, 3.3, { duration: 0.9 });
  rise(tl, one(root, "progress-label"), 3.4, { y: 8, duration: 0.4 });
  rise(tl, one(root, "track"), 3.4, { y: 0, duration: 0.4 });
  tl.set(one(root, "progress"), { autoAlpha: 1 }, 3.5);
  tl.fromTo(
    one(root, "progress"),
    { scaleX: 0, transformOrigin: "left center" },
    { scaleX: 1, duration: 1.8, ease: ease.inOut },
    3.5,
  );
  swap(tl, one(root, "state-0-plan"), one(root, "state-0-busy"), 3.6, 0.2);
  swap(tl, one(root, "state-0-busy"), one(root, "state-0-done"), 4.4, 0.25);
  swap(tl, one(root, "state-1-plan"), one(root, "state-1-busy"), 4.2, 0.2);
  swap(tl, one(root, "state-1-busy"), one(root, "state-1-done"), 5.1, 0.25);
  swap(tl, one(root, "progress-label"), one(root, "progress-done"), 5.3, 0.3);

  // Keep the receipt.
  drop(tl, second, 5.9);
  lift(tl, third, 6.0, { duration: 0.9 });
  draw(tl, one(root, "tie"), 5.6, { axis: "y", duration: 0.4 });
  rise(tl, one(root, "receipt"), 5.9, { y: 40, duration: 0.8 });
  rise(tl, all(root, "receipt-line"), 6.4, { y: 10, duration: 0.5, stagger: 0.18 });
  rise(tl, one(root, "receipt-status"), 7.2, { y: 10, duration: 0.5 });
};
