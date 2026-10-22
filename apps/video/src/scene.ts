import type { gsap } from "gsap";
import type { ReactElement } from "react";

export interface SceneMarkup {
  readonly id: string;
  readonly render: () => ReactElement;
}

export type SceneMotion = (tl: gsap.core.Timeline, root: HTMLElement) => void;

export interface Shot {
  readonly scene: string;
  readonly start: number;
  readonly duration: number;
}

export interface Cut {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly shots: ReadonlyArray<Shot>;
  readonly music?: boolean;
}
