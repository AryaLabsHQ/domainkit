import type { SceneMotion } from "../../scene";
import { all, draw, ease, lift, one, rise } from "../motion-kit";

/** 0.2 headline. 1.0 frame. 1.6 host-owned chips. 3.6 DomainKit inside. 5.4 the line out. Holds to 8s. */
export const boundary: SceneMotion = (tl, root) => {
  draw(tl, one(root, "header-rule"), 0.1, { duration: 0.6 });
  lift(tl, one(root, "line"), 0.2, { duration: 0.9 });
  rise(tl, one(root, "lede"), 0.7, { y: 14, duration: 0.7 });
  tl.fromTo(
    one(root, "frame"),
    { autoAlpha: 0, y: 30 },
    { autoAlpha: 1, y: 0, duration: 0.8, ease: ease.out },
    1.0,
  );
  rise(tl, one(root, "frame-label"), 1.4, { y: 0, duration: 0.4 });
  rise(tl, all(root, "owned"), 1.8, { y: 18, duration: 0.55, stagger: 0.28 });
  tl.fromTo(
    one(root, "engine"),
    { autoAlpha: 0, scale: 0.96, transformOrigin: "50% 50%" },
    { autoAlpha: 1, scale: 1, duration: 0.8, ease: ease.out },
    3.9,
  );
  rise(tl, all(root, "verb"), 4.4, { y: 8, duration: 0.4, stagger: 0.12 });
  draw(tl, one(root, "link"), 5.5, { duration: 0.6 });
  rise(tl, one(root, "link-head"), 6.0, { y: 0, duration: 0.2 });
  rise(tl, one(root, "provider"), 5.8, { y: 20, duration: 0.7 });
  rise(tl, all(root, "provider-card"), 6.1, { y: 16, duration: 0.6, stagger: 0.2 });
};
