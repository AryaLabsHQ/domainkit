/**
 * Who is acting. Required by every lifecycle operation and every Storage query; there is no
 * default, so cross-tenant access is a type error rather than a runtime check. `domainkit/server`
 * provides it per request from the host's `Identity`.
 */
import { Context, Layer } from "effect";

export interface Shape {
  /** Tenant boundary: organization, workspace, account. Storage scopes every row by it. */
  readonly ownerId: string;
  /** The user or automation acting on the tenant's behalf; recorded on approvals and receipts. */
  readonly actorId: string;
}

export class Principal extends Context.Service<Principal, Shape>()("@domainkit/Principal") {}

export const make = (input: Shape): Shape => ({ ownerId: input.ownerId, actorId: input.actorId });

export const layer = (input: Shape): Layer.Layer<Principal> =>
  Layer.succeed(Principal)(make(input));
