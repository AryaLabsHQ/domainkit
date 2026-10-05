import { DateTime, Effect } from "effect";
import { Approval, Connect, DnsRecord, Plan, Provision, Receipt, Verify } from "domainkit";

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
export interface HostnameInput {
  readonly hostname: string;
  readonly route: { readonly cname: string } | { readonly address: string };
  /** Vercel omits `verification` when it needs no ownership proof. */
  readonly verification?:
    | ReadonlyArray<{ readonly domain: string; readonly value: string }>
    | undefined;
}

export const requirements = (input: HostnameInput) => [
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
  ...(input.verification ?? []).map((record) =>
    DnsRecord.txt({
      name: record.domain,
      value: record.value,
      purpose: "Prove you own the domain",
    }),
  ),
];
// #endregion requirements

// #region attach-apex
/**
 * Connect and attach the registrable domain (`apexName`), not the subdomain. Vercel's ownership
 * TXT record sits at `_vercel.<apexName>`, so the plan, the connection, and the later observation
 * all use the apex. `Resolved` means the customer already connected an account that reaches it.
 */
export const connectApex = (apexName: string) =>
  Effect.gen(function* () {
    const discovery = yield* Connect.discover(apexName);
    if (discovery._tag !== "Resolved") return discovery;
    return yield* Connect.attach({
      connectionId: discovery.connectionId,
      domain: apexName,
      target: discovery.target,
    });
  });
// #endregion attach-apex

// #region plan
/**
 * One plan per apex. Pass every hostname the customer has under it: a later plan replaces the
 * earlier one as the receipt that observation reads, so a second hostname rebuilds the plan from
 * all of them. The records already in the zone become no-ops. This step never writes.
 */
export const planForCustomer = (input: {
  readonly apexName: string;
  readonly hostnames: ReadonlyArray<HostnameInput>;
}) => {
  const records = new Map(
    input.hostnames
      .flatMap(requirements)
      .map((record) => [`${record._tag}|${record.name}|${DnsRecord.data(record)}`, record]),
  );
  return Provision.plan({ domain: input.apexName, requirements: [...records.values()] });
};
// #endregion plan

// #region apply
/**
 * Two calls, with the customer's decision between them. Show `Plan.writes(plan)` first; run
 * `approveReviewedPlan` only when they press approve, then `applyApproved`. Apply re-plans and
 * fails `Stale` when the zone moved. A partial receipt is data: its `outcomes` say which write
 * failed and why.
 */
export const approveReviewedPlan = (planId: Plan.PlanId) => Provision.approve(planId);

export const applyApproved = (approval: Approval.Model) =>
  Effect.map(Provision.apply(approval), (receipt) => ({
    complete: Receipt.isComplete(receipt),
    written: Receipt.applied(receipt).length,
    outcomes: receipt.outcomes,
  }));
// #endregion apply

// #region vercel-status
/**
 * Run this from your own job until the hostname works. It observes the apex's DNS first and attaches
 * Vercel's answer only afterwards. Vercel, not DNS, decides when it serves the
 * hostname, so its answer is host evidence beside DomainKit's observation. The status is `ok` only
 * when Vercel has verified the domain and its configuration reports `misconfigured: false`. The
 * `source` carries the hostname, so two hostnames under one domain keep separate rows. A request
 * that errors or is rejected is `failed`, not a hostname that is merely waiting.
 */
export const recordVercelStatus = (input: {
  readonly apexName: string;
  readonly hostname: string;
  readonly token: string;
}) =>
  Effect.gen(function* () {
    // DNS first: host evidence alone would read as ready, because nothing has been observed yet.
    yield* Verify.observe({ domain: input.apexName });
    const ask = (url: string) =>
      Effect.tryPromise(async () => {
        const response = await fetch(url, { headers: vercelHeaders(input.token) });
        if (!response.ok) return { body: null, problem: `HTTP ${response.status}` };
        try {
          return { body: (await response.json()) as unknown, problem: null };
        } catch {
          return { body: null, problem: `HTTP ${response.status} with an unreadable body` };
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({ body: null, problem: `request error: ${String(error)}` }),
        ),
      );
    const domain = yield* ask(
      `https://api.vercel.com/v9/projects/${projectId}/domains/${input.hostname}`,
    );
    const config = yield* ask(
      `https://api.vercel.com/v6/domains/${input.hostname}/config?projectIdOrName=${projectId}`,
    );
    const verified = (domain.body as { readonly verified?: boolean } | null)?.verified === true;
    const misconfigured =
      (config.body as { readonly misconfigured?: boolean } | null)?.misconfigured !== false;
    const failed = domain.body === null || config.body === null;
    const observedAt = yield* DateTime.now;
    return yield* Verify.attachEvidence({
      domain: input.apexName,
      evidence: [
        new Verify.HostEvidence({
          source: `vercel-domain:${input.hostname}`,
          status: failed ? "failed" : verified && !misconfigured ? "ok" : "pending",
          label: `Vercel serves ${input.hostname}`,
          detail: failed
            ? `Vercel request failed (${domain.problem ?? config.problem})`
            : verified && !misconfigured
              ? null
              : verified
                ? "Vercel reports the DNS as misconfigured"
                : "Vercel has not verified the domain yet",
          observedAt,
        }),
      ],
    });
  });
// #endregion vercel-status
