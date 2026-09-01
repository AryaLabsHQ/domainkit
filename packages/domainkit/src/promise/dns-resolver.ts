import { AsyncResolution } from "../verification/resolver.ts";

export const Resolution = AsyncResolution;
export type Resolution = typeof AsyncResolution.Type;

export type { Answer, AsyncInterface as Interface, Query } from "../verification/resolver.ts";
