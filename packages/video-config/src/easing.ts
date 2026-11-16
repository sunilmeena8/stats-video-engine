import type { EasingName } from '@statsopedia/shared-types';

/** Easing curves on [0, 1] → [0, 1]. Pure, so any frame can be computed on its own. */
export const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export function ease(name: EasingName, t: number): number {
  return EASINGS[name](Math.min(Math.max(t, 0), 1));
}
