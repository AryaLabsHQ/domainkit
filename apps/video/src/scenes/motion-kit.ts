import { gsap } from "gsap";

/**
 * Motion helpers shared by every scene. Motion lives only on the scene's paused GSAP timeline: no
 * timers, clocks, randomness, or CSS transitions. Eases are GSAP's own so a seek is exact.
 */
export { gsap };

export const ease = {
  out: "power3.out",
  soft: "expo.out",
  inOut: "power2.inOut",
  linear: "none",
} as const;

type Timeline = gsap.core.Timeline;

/** Every element in a scene marked `data-a="<name>"`, in document order. */
export function all(root: HTMLElement, name: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-a="${name}"]`));
}

/** The one element marked `data-a="<name>"`. */
export function one(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-a="${name}"]`);
  if (element === null)
    throw new Error(`scene ${root.dataset.compositionId} has no [data-a="${name}"]`);
  return element;
}

/** Fade and lift into place. */
export function rise(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { y?: number; duration?: number; stagger?: number; ease?: string } = {},
): void {
  tl.fromTo(
    targets,
    { autoAlpha: 0, y: vars.y ?? 28 },
    {
      autoAlpha: 1,
      y: 0,
      duration: vars.duration ?? 0.6,
      ease: vars.ease ?? ease.out,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Rise a line of display type out of its mask. */
export function lift(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { duration?: number; stagger?: number } = {},
): void {
  tl.fromTo(
    targets,
    { autoAlpha: 0, yPercent: 112 },
    {
      autoAlpha: 1,
      yPercent: 0,
      duration: vars.duration ?? 0.8,
      ease: ease.soft,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Send a line of display type out of its mask, hidden once it has gone. */
export function drop(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { duration?: number; stagger?: number } = {},
): void {
  tl.to(
    targets,
    {
      autoAlpha: 0,
      yPercent: -112,
      duration: vars.duration ?? 0.6,
      ease: ease.inOut,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Draw a hairline or bar from its origin edge. */
export function draw(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { axis?: "x" | "y"; duration?: number; stagger?: number } = {},
): void {
  const axis = vars.axis ?? "x";
  tl.fromTo(
    targets,
    axis === "x" ? { scaleX: 0 } : { scaleY: 0 },
    {
      ...(axis === "x" ? { scaleX: 1 } : { scaleY: 1 }),
      duration: vars.duration ?? 0.8,
      ease: ease.inOut,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Swap one stacked element for another in the same slot. */
export function swap(
  tl: Timeline,
  from: gsap.TweenTarget,
  to: gsap.TweenTarget,
  at: number,
  duration = 0.25,
): void {
  tl.to(from, { autoAlpha: 0, duration, ease: ease.out }, at);
  tl.fromTo(to, { autoAlpha: 0 }, { autoAlpha: 1, duration, ease: ease.out }, at);
}

/** Move the pointer to a point in scene coordinates. */
export function point(
  tl: Timeline,
  cursor: HTMLElement,
  x: number,
  y: number,
  at: number,
  duration = 0.9,
): void {
  tl.to(cursor, { x, y, duration, ease: ease.inOut }, at);
}

/** A press: the pointer dips and returns. */
export function press(tl: Timeline, cursor: HTMLElement, at: number): void {
  tl.to(cursor, { scale: 0.86, duration: 0.09, ease: ease.out, transformOrigin: "9px 6px" }, at);
  tl.to(cursor, { scale: 1, duration: 0.18, ease: ease.out }, at + 0.09);
}

/** The pointer starts off-stage; revealing it never moves it. */
export function arrive(tl: Timeline, cursor: HTMLElement, x: number, y: number, at: number): void {
  tl.set(cursor, { x, y, autoAlpha: 0 }, 0);
  tl.to(cursor, { autoAlpha: 1, duration: 0.2, ease: ease.out }, at);
}

/** Settle a still: everything the scene shows is in place by one second. */
export const STILL_SETTLE = 1;
