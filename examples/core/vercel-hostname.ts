import { DateTime, Effect } from "effect";
import { DnsRecord, Provision, Verify } from "domainkit";

const projectId = "prj_saas_app";
const vercelHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

// #region add-to-project
/**
 * Vercel's API, not DomainKit, attaches the customer's hostname to your own Vercel project. The
 * response names the registrable domain (`apexName`) and any TXT proof Vercel still wants.
 */
export const addToProject = async (input: {
  readonly hostname: string;
  readonly token: string;
}) => {
  const response = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
    method: "POST",
    headers: vercelHeaders(input.token),
    body: JSON.stringify({ name: input.hostname }),
  });
  if (!response.ok) throw new Error(`Vercel refused ${input.hostname}: ${response.status}`);
  return (await response.json()) as {
    readonly name: string;
    readonly apexName: string;
    readonly verified: boolean;
    readonly verification?: ReadonlyArray<{
      readonly type: string;
      readonly domain: string;
      readonly value: string;
    }>;
  };
};
// #endregion add-to-project

// #region route
/**
 * Where Vercel says the hostname should point: a CNAME target for a subdomain, an address for an
 * apex domain. Read it from Vercel's domain configuration rather than hard-coding a value.
 */
export const recommendedRoute = async (input: {
  readonly hostname: string;
  readonly apexName: string;
  readonly token: string;
}) => {
  const response = await fetch(
    `https://api.vercel.com/v6/domains/${input.hostname}/config?projectIdOrName=${projectId}`,
    { headers: vercelHeaders(input.token) },
  );
  if (!response.ok)
    throw new Error(`Vercel config failed for ${input.hostname}: ${response.status}`);
  const config = (await response.json()) as {
    readonly recommendedCNAME?: ReadonlyArray<{ readonly rank: number; readonly value: string }>;
    readonly recommendedIPv4?: ReadonlyArray<{
      readonly rank: number;
      readonly value: ReadonlyArray<string>;
    }>;
  };
  const best = <A extends { readonly rank: number }>(options: ReadonlyArray<A> | undefined) =>
    [...(options ?? [])].sort((left, right) => left.rank - right.rank)[0];
  const address = best(config.recommendedIPv4)?.value[0];
  const cname = best(config.recommendedCNAME)?.value;
  const route =
    input.hostname === input.apexName ? (address ? { address } : null) : cname ? { cname } : null;
  if (route === null) throw new Error(`Vercel gave no route for ${input.hostname}`);
  return route;
};
// #endregion route

// #region requirements
/**
 * What Vercel told you the customer must add: where the hostname should point, and any TXT proof
 * Vercel asked for. Pass the values Vercel returned; do not copy them from a docs page.
 */
export const requirements = (input: {
  readonly hostname: string;
  readonly route: { readonly cname: string } | { readonly address: string };
  readonly verification: ReadonlyArray<{ readonly domain: string; readonly value: string }>;
}) => [
  "cname" in input.route
    ? DnsRecord.cname({
        name: input.hostname,
        target: input.route.cname,
        purpose: "Send traffic to your app",
      })
    : DnsRecord.a({
        name: input.hostname,
        address: input.route.address,
        purpose: "Send traffic to your app",
      }),
  ...input.verification.map((record) =>
    DnsRecord.txt({
      name: record.domain,
      value: record.value,
      purpose: "Prove you own the domain",
    }),
  ),
];
// #endregion requirements

// #region plan
/**
 * Plan against the registrable domain, not the subdomain. Vercel's ownership TXT record sits at
 * `_vercel.<apexName>`, and every requirement must be at or below the attached domain. This step
 * never writes.
 */
export const planForCustomer = (
  input: Parameters<typeof requirements>[0] & { readonly apexName: string },
) => Provision.plan({ domain: input.apexName, requirements: requirements(input) });
// #endregion plan

// #region vercel-status
/**
 * Run this from your own job until Vercel reports the hostname verified. Vercel, not DNS, decides
 * when it serves the hostname, so its answer is host evidence beside DomainKit's observation.
 */
export const recordVercelStatus = (input: {
  readonly apexName: string;
  readonly hostname: string;
  readonly token: string;
}) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      fetch(`https://api.vercel.com/v9/projects/${projectId}/domains/${input.hostname}`, {
        headers: vercelHeaders(input.token),
      }),
    );
    const verified =
      response.ok &&
      ((yield* Effect.promise(() => response.json())) as { verified?: boolean }).verified === true;
    const observedAt = yield* DateTime.now;
    return yield* Verify.attachEvidence({
      domain: input.apexName,
      evidence: [
        new Verify.HostEvidence({
          source: "vercel-domain",
          status: verified ? "ok" : "pending",
          label: "Vercel serves the hostname",
          detail: verified ? null : "Vercel has not verified the domain yet",
          observedAt,
        }),
      ],
    });
  });
// #endregion vercel-status
