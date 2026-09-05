import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { DomainKit, Testing } from "@domainkit/react";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { ProviderArtwork } from "@/components/domainkit/provider-row";

export const previewZone = "northwind.app";
export const previewDomain = `mail.${previewZone}`;

export const previewRequirements = [
  DnsRecord.txt({
    name: `samva._domainkey.${previewDomain}`,
    purpose: "Sign your mail",
    value: "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA",
  }),
  DnsRecord.mx({
    exchange: "feedback-smtp.us-east-1.amazonses.com",
    name: `mail.${previewDomain}`,
    priority: 10,
    purpose: "Receive bounce reports",
  }),
  DnsRecord.txt({
    name: `mail.${previewDomain}`,
    purpose: "Authorize the sender",
    value: "v=spf1 include:amazonses.com ~all",
  }),
];

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
  seed = [],
}: PreviewOptions & { readonly children: ReactNode }) {
  const transport = useMemo(
    () =>
      Testing.transport({
        provider: {
          id: "meridian",
          name: "Meridian DNS",
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
