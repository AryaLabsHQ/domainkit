import { Effect } from "effect";

import * as EffectAuth from "../providers/vercel/auth.ts";

export const integrationMethod = EffectAuth.integrationMethod;
export const manifest = EffectAuth.manifest;
export const tokenMethod = EffectAuth.tokenMethod;
export type {
  ExchangeCodeOptions,
  IntegrationCredential,
  IntegrationMethodOptions,
} from "../providers/vercel/auth.ts";

export function exchangeCode(
  options: EffectAuth.ExchangeCodeOptions,
): Promise<EffectAuth.IntegrationCredential> {
  return Effect.runPromise(EffectAuth.exchangeCode(options));
}
