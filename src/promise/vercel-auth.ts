import { Effect } from "effect";

import * as EffectAuth from "../providers/vercel/auth.ts";
import * as Connection from "./connection.ts";

export const integrationMethod = EffectAuth.integrationMethod;
export const manifest = EffectAuth.manifest;
export const tokenMethod = EffectAuth.tokenMethod;
export type {
  ExchangeCodeOptions,
  IntegrationCredential,
  IntegrationFlowOptions,
  IntegrationMethodOptions,
} from "../providers/vercel/auth.ts";

export function exchangeCode(
  options: EffectAuth.ExchangeCodeOptions,
): Promise<EffectAuth.IntegrationCredential> {
  return Effect.runPromise(EffectAuth.exchangeCode(options));
}

/** Creates Vercel Integration's implementation for the Promise connection facade. */
export function integrationFlow(
  options: EffectAuth.IntegrationFlowOptions,
): Connection.InteractiveFlow {
  return Connection.fromEffectFlow(EffectAuth.integrationFlow(options));
}

/** Creates a Vercel token method for the Promise connection facade. */
export function tokenConnectionMethod(
  options: EffectAuth.TokenConnectionOptions,
): Extract<Connection.Method, { readonly _tag: "Token" }> {
  return Connection.fromEffectTokenMethod(EffectAuth.tokenConnectionMethod(options));
}
