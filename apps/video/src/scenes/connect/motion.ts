import type { SceneMotion } from "../../scene";
import { all, arrive, draw, ease, lift, one, point, press, rise, swap } from "../motion-kit";
import { rowTarget, start } from "./layout";

/** 0.2 headline. 0.5 dialog. 2.2 the pointer picks Cloudflare. 3.1 connected. Holds to 7s. */
export const connect: SceneMotion = (tl, root) => {
  const cursor = one(root, "cursor");
  const cloudflare = rowTarget(0);

  rise(tl, one(root, "kicker"), 0.1, { y: 10, duration: 0.5 });
  lift(tl, all(root, "line"), 0.2, { duration: 0.85, stagger: 0.12 });
  rise(tl, one(root, "lede"), 1.4, { y: 14, duration: 0.6 });
  tl.fromTo(
    one(root, "dialog"),
    { autoAlpha: 0, y: 40 },
    { autoAlpha: 1, y: 0, duration: 0.8, ease: ease.out },
    0.5,
  );

  tl.set(one(root, "row-ring"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "row-connected"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "destination"), { autoAlpha: 0 }, 0);

  arrive(tl, cursor, start.x, start.y, 1.4);
  point(tl, cursor, cloudflare.x, cloudflare.y, 1.5, 1.0);
  press(tl, cursor, 2.6);
  tl.fromTo(
    one(root, "row-ring"),
    { autoAlpha: 0, scale: 0.97 },
    { autoAlpha: 1, scale: 1, duration: 0.3, ease: ease.out },
    2.6,
  );
  swap(tl, one(root, "row-ring"), one(root, "row-connected"), 3.3, 0.3);
  tl.to(one(root, "cloudflare-content"), { autoAlpha: 0, duration: 0.15, ease: ease.out }, 3.3);
  tl.fromTo(
    one(root, "check"),
    { scale: 0.4 },
    { scale: 1, duration: 0.4, ease: "back.out(2)" },
    3.3,
  );
  tl.to(one(root, "row-vercel"), { opacity: 0.4, duration: 0.4, ease: ease.out }, 3.4);
  rise(tl, one(root, "destination"), 3.9, { y: 12, duration: 0.6 });
  tl.to(cursor, { autoAlpha: 0, x: "+=60", y: "+=50", duration: 0.5, ease: ease.out }, 3.9);
  draw(tl, one(root, "header-rule"), 0.1, { duration: 0.6 });
};
