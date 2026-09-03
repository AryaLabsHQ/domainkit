import { Effect } from "effect";
import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";

// #region create
/** Point it at the path the route group is mounted on. No credential ever reaches this code. */
export const transport = Transport.fromFetch("/api/domainkit");
// #endregion create

// #region headers
/** Headers can be static or resolved per request, for a token your app refreshes on its own. */
export const authenticated = Transport.fromFetch("https://api.acme.dev/domainkit", {
  headers: async () => ({ authorization: `Bearer ${await currentAccessToken()}` }),
});
// #endregion headers

// #region capabilities
/**
 * A host that mounts only part of the group declares only those groups. `Transport.capabilities`
 * reports what is there, and `@domainkit/react` renders only those parts of the flow.
 */
export const connectOnly = Transport.fromFetch("/api/domainkit", {
  capabilities: ["connection"],
});

export const declared = Transport.capabilities(connectOnly); // ["connection"]
// #endregion capabilities

// #region call
/** Every method is an `Effect` that fails with the `DomainKit.Error` the lifecycle raised. */
export const plan = Effect.gen(function* () {
  const provisioning = transport.provisioning;
  if (provisioning === undefined) return null;
  return yield* provisioning.plan({
    domain: "app.example.com",
    requirements: [DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev" })],
  });
});
// #endregion call

// #region promises
/** The same transport in Promises, for a component tree that does not run Effect. */
export const api = Transport.toAsync(transport);

export const inspect = async (domain: string) => api.connection?.inspect(domain);
// #endregion promises

declare function currentAccessToken(): Promise<string>;
