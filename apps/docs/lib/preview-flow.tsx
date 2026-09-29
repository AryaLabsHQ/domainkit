import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { DomainKit, Testing } from "@domainkit/react";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { ProviderArtwork } from "@/components/domainkit/provider-artwork";

export const previewZone = "northwind.app";
export const previewDomain = `mail.${previewZone}`;

/**
 * The records a sending domain needs. Names are fully qualified: the domain itself carries the SPF
 * and bounce records, and the DKIM selector and tracking host sit one label below it.
 */
export const requirementsFor = (domain: string): ReadonlyArray<DnsRecord.Model> => [
  DnsRecord.txt({
    name: `samva._domainkey.${domain}`,
    purpose: "Sign your mail",
    value: "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA",
  }),
  DnsRecord.mx({
    exchange: "feedback-smtp.us-east-1.amazonses.com",
    name: domain,
    priority: 10,
    purpose: "Receive bounce reports",
  }),
  DnsRecord.txt({
    name: domain,
    purpose: "Authorize the sender",
    value: "v=spf1 include:amazonses.com ~all",
  }),
  DnsRecord.cname({
    name: `track.${domain}`,
    purpose: "Track opens and clicks",
    target: "track.samva.dev",
  }),
];

/**
 * What the zone already holds: the SPF record matches its requirement (a no-op), and the other
 * three are missing (creates), so one apply brings the domain to verified.
 */
export const seedFor = (domain: string): ReadonlyArray<DnsRecord.Model> => [
  DnsRecord.txt({ name: domain, value: "v=spf1 include:amazonses.com ~all" }),
];

/**
 * The same zone with an A record on the tracking host. A CNAME cannot share a name, so that
 * requirement is a conflict: the plan approves the creates and leaves the blocked record for the
 * customer to fix at their provider.
 */
export const conflictSeedFor = (domain: string): ReadonlyArray<DnsRecord.Model> => [
  ...seedFor(domain),
  DnsRecord.a({ name: `track.${domain}`, address: "203.0.113.10" }),
];

export const previewRequirements = requirementsFor(previewDomain);
export const previewSeed = seedFor(previewDomain);
export const previewConflictSeed = conflictSeedFor(previewDomain);

/** Square artwork a host passes in, which is what the mark renders with nothing wrapped round it. */
export const previewMarks: ProviderArtwork = {
  meridian: (
    <svg aria-hidden="true" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#312e81" height="32" rx="8" width="32" />
      <g fill="none" stroke="#c7d2fe" strokeWidth="1.8">
        <circle cx="16" cy="16" r="8.5" />
        <ellipse cx="16" cy="16" rx="3.6" ry="8.5" />
        <path d="M7.5 16h17" />
      </g>
    </svg>
  ),
};

export interface PreviewOptions {
  /** Records the zone already holds, so a plan can show a no-op or a conflict beside a create. */
  readonly seed?: ReadonlyArray<DnsRecord.Model>;
  readonly oauth?: boolean;
  readonly readOnly?: boolean;
  /** Start the frame with the account already granted, for the states that follow a connect. */
  readonly connected?: boolean;
}

/**
 * Every preview runs the real lifecycle. `Testing.transport` mounts `domainkit/server` over memory
 * storage and a fake provider in this frame, so connecting, planning, approving, applying,
 * observing, and cleaning up behave the way they do against a host.
 */
export function PreviewRoot({
  children,
  connected = false,
  oauth = false,
  readOnly = false,
  seed = previewSeed,
}: PreviewOptions & { readonly children: ReactNode }) {
  const transport = useMemo(
    () =>
      Testing.transport({
        provider: {
          id: "meridian",
          name: "Meridian",
          // The zone's nameservers are this provider's own, so discovery names it as the host.
          nameserverSuffixes: [previewZone],
          labels: { [previewZone]: `${previewZone} (Northwind Traders)` },
          oauth,
          records: seed.map((record) => ({ record, zone: previewZone })),
          zones: [previewZone],
        },
      }),
    [oauth, seed],
  );
  // The grant is the customer's, so a preview that starts past it makes it over the transport
  // rather than by driving the dialog: the surface below then renders the state that follows.
  const [ready, setReady] = useState(!connected);
  useEffect(() => {
    if (ready) return;
    const connection = transport.connection;
    if (connection === undefined) return;
    void Effect.runPromise(
      connection.start({
        domain: previewDomain,
        method: Transport.Method.token({ token: "preview" }),
        provider: "meridian",
      }),
    ).then(
      () => setReady(true),
      () => setReady(true),
    );
  }, [ready, transport]);
  if (!ready) return null;
  return (
    <DomainKit.Root navigate={() => {}} readOnly={readOnly} transport={transport}>
      <div className="w-full max-w-3xl p-4">{children}</div>
    </DomainKit.Root>
  );
}
