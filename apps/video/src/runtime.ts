import { gsap } from "gsap";
import { motions } from "./scenes/motion";

function scene(sceneId: string, compositionId: string): gsap.core.Timeline {
  const root = document.querySelector<HTMLElement>(`[data-composition-id="${compositionId}"]`);
  const motion = motions[sceneId];
  if (root === null || motion === undefined)
    throw new Error(`cannot mount ${sceneId} as ${compositionId}`);
  const timeline = gsap.timeline({ paused: true });
  motion(timeline, root);
  return timeline;
}
Object.assign(window, { domainkitVideo: { scene } });
