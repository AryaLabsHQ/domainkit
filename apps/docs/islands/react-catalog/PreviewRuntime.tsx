import { DnsRecord, Receipt } from "domainkit";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Cleanup,
  Connect,
  Domain,
  DomainKit,
  Provider,
  Provision,
  Records,
  Testing,
  Verify,
  type Event,
} from "@domainkit/react";

import {
  defaultRequirements,
  previewZone,
  seedOf,
  storyKey,
  type PreviewState,
} from "./preview-state.ts";
import { workshopTheme } from "./themes.ts";

interface ProviderSettings {
  readonly oauth: boolean;
  readonly providerId: string;
  /** The records the zone already holds, so a seeded plan shows one Create and one Noop. */
  readonly seed: ReadonlyArray<DnsRecord.Model>;
}

/**
 * Every preview runs the real lifecycle. `Testing.transport` mounts `domainkit/server` over memory
 * storage and a fake provider in this tab, so connecting, planning, approving, applying, observing,
 * and cleaning up all behave the way they do against a host.
 */
const makeTransport = (settings: ProviderSettings) =>
  Testing.transport({
    provider: {
      id: settings.providerId,
      oauth: settings.oauth,
      zones: [previewZone],
      records: settings.seed.map((record) => ({ record, zone: previewZone })),
    },
  });

function Verification({ domain }: { readonly domain: string }) {
  const controller = Verify.useController({ domain });
  return <Verify.Status controller={controller} />;
}

function ProviderMark({ providerId }: { readonly providerId: string }) {
  const connection = Connect.useController({ domain: `app.${previewZone}` });
  const provider = connection.providers.find((candidate) => candidate.id === providerId);
  return provider === undefined ? null : (
    <div data-preview-spot="">
      <Provider.Mark provider={provider} />
    </div>
  );
}

function Story({ state }: { readonly state: PreviewState }) {
  const { domain, providerId, requirements } = state;
  switch (state.story) {
    case "domain-flow":
      return <Domain.Flow domain={domain} requirements={requirements} />;
    case "connect":
      return <Connect.Flow domain={domain} />;
    case "provision":
      return (
        <Provision.Flow domain={domain} requirements={requirements} trigger="Review changes" />
      );
    case "cleanup":
      return <Cleanup.Flow domain={domain} trigger="Remove records" />;
    case "records":
      return (
        <div data-preview-stack="">
          <Records.ZoneFile domain={domain} records={requirements} />
          <Records.Table caption={`DNS for ${domain}`} records={requirements} />
        </div>
      );
    case "record-card":
      return (
        <div data-preview-stack="">
          {requirements.map((record) => (
            <Records.Card key={Records.identity(record)} record={record} />
          ))}
        </div>
      );
    case "verification":
      return <Verification domain={domain} />;
    case "provider-mark":
      return <ProviderMark providerId={providerId} />;
    case "slots":
      return (
        <Domain.Flow
          domain={domain}
          requirements={requirements}
          slots={{
            records: ({ readiness, records }) => (
              <Records.Table caption="Add these records" readiness={readiness} records={records} />
            ),
          }}
        />
      );
  }
}

export function Preview({ state }: { readonly state: PreviewState }) {
  const [event, setEvent] = useState<Event>();
  useEffect(() => {
    if (event === undefined) return;
    const timeout = window.setTimeout(() => setEvent(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [event]);
  const seed = seedOf(state);
  const key = storyKey(state);
  const transport = useMemo(
    () => makeTransport({ oauth: state.oauth, providerId: state.providerId, seed }),
    [key],
  );
  const notification: ReactNode =
    event === undefined ? null : (
      <div data-preview-notification="" role="status">
        {event._tag === "Applied" || event._tag === "Cleaned"
          ? `${event._tag} ${Receipt.applied(event.receipt).length} record(s)`
          : event._tag}
      </div>
    );
  return (
    // A new server is a new world: the controllers hold a connection, a plan, and readiness the
    // replacement never issued, so the story remounts with it rather than mixing the two.
    <DomainKit.Root
      colorScheme={state.colorScheme}
      key={key}
      onEvent={setEvent}
      readOnly={state.readOnly}
      theme={workshopTheme(state.theme, state.colorScheme)}
      transport={transport}
    >
      <Story state={state} />
      {notification}
    </DomainKit.Root>
  );
}

export { defaultRequirements };
export default Preview;
