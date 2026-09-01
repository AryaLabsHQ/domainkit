import { AsyncResolution } from "../verification/resolver.ts";
import type { AsyncResolution as AsyncResolutionValue } from "../verification/resolver.ts";

export const Resolution = AsyncResolution;
export type Resolution = AsyncResolutionValue;

export type { Answer, AsyncInterface as Interface, Query } from "../verification/resolver.ts";
