import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Select as BaseSelect } from "@base-ui/react/select";
import {
  ArrowDown01Icon,
  Copy01Icon,
  Download01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DialRoot, useDialKitController, type DialConfig } from "dialkit";
import { DomainName, Transport } from "domainkit";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Cleanup,
  Connection,
  Domain,
  DomainKit,
  Lifecycle,
  Provisioning,
  Provider,
  Records,
  Testing,
  Verification,
} from "../../../src/index.ts";

import { nextRecordId } from "./workshop-records.ts";
import {
  isWorkshopThemeId,
  workshopTheme,
  workshopThemePresets,
  type WorkshopThemeId,
} from "./workshop-themes.ts";

const workshopIcons = {
  copied: <HugeiconsIcon icon={Tick02Icon} />,
  copy: <HugeiconsIcon icon={Copy01Icon} />,
  download: <HugeiconsIcon icon={Download01Icon} />,
};

function ToolbarSelect({
  label,
  onValueChange,
  options,
  value,
}: {
  readonly label: string;
  readonly onValueChange: (value: string) => void;
  readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly value: string;
}) {
  return (
    <label data-workshop-global-control="">
      <span>{label}</span>
      <BaseSelect.Root
        items={options}
        onValueChange={(nextValue) => {
          if (nextValue !== null) onValueChange(nextValue);
        }}
        value={value}
      >
        <BaseSelect.Trigger aria-label={label} data-workshop-select-trigger="">
          <BaseSelect.Value />
          <BaseSelect.Icon data-workshop-select-icon="">
            <HugeiconsIcon icon={ArrowDown01Icon} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner align="end" data-workshop-select-positioner="" sideOffset={5}>
            <BaseSelect.Popup data-workshop-select-popup="">
              <BaseSelect.List>
                {options.map((option) => (
                  <BaseSelect.Item
                    data-workshop-select-item=""
                    key={option.value}
                    value={option.value}
                  >
                    <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator data-workshop-select-indicator="">
                      <HugeiconsIcon icon={Tick02Icon} />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </label>
  );
}

const defaultRecords: ReadonlyArray<Transport.DnsRecord> = [
  {
    id: "mx",
    name: "mail.example.com",
    priority: 10,
    type: "MX",
    value: "feedback-smtp.example.net",
  },
  {
    id: "spf",
    name: "mail.example.com",
    type: "TXT",
    value: "v=spf1 include:example.net ~all",
  },
];

const stories = [
  { id: "connection", group: "Flows", title: "Connection" },
  { id: "host-connection", group: "Flows", title: "Host connection" },
  { id: "host-lifecycle", group: "Flows", title: "Host lifecycle" },
  { id: "lifecycle", group: "Flows", title: "Domain" },
  { id: "records", group: "Presentational", title: "Records" },
  { id: "card", group: "Presentational", title: "Record Card" },
  { id: "provider", group: "Presentational", title: "Provider Mark" },
  { id: "verification", group: "Presentational", title: "Verification" },
] as const;

type StoryId = (typeof stories)[number]["id"];

export interface WorkshopState {
  readonly colorScheme: "dark" | "light";
  readonly domain: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly receipt: boolean;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly story: StoryId;
  readonly targetState: "ambiguous" | "unavailable" | "unique";
  readonly theme: WorkshopThemeId;
}

function isStoryId(value: string): value is StoryId {
  switch (value) {
    case "card":
    case "connection":
    case "host-connection":
    case "host-lifecycle":
    case "lifecycle":
    case "provider":
    case "records":
    case "verification":
      return true;
    default:
      return false;
  }
}

export function stateFromSearch(search: string): WorkshopState {
  const parameters = new URLSearchParams(search);
  const storyParameter = parameters.get("story");
  const themeParameter = parameters.get("theme");
  const targetParameter = parameters.get("targets");
  return {
    colorScheme: parameters.get("mode") === "dark" ? "dark" : "light",
    domain: "mail.example.com",
    providerId: "cloudflare",
    providerName: "Cloudflare",
    receipt: true,
    records: defaultRecords,
    story:
      storyParameter !== null && isStoryId(storyParameter)
        ? storyParameter
        : parameters.get("flow") === "lifecycle"
          ? "lifecycle"
          : "connection",
    targetState:
      targetParameter === "ambiguous" || targetParameter === "unavailable"
        ? targetParameter
        : "unique",
    theme:
      themeParameter !== null && isWorkshopThemeId(themeParameter) ? themeParameter : "neutral",
  };
}

function searchFromState(
  state: Pick<WorkshopState, "colorScheme" | "story" | "targetState" | "theme">,
): string {
  const parameters = new URLSearchParams();
  parameters.set("story", state.story);
  if (state.story === "lifecycle") parameters.set("flow", "lifecycle");
  parameters.set("mode", state.colorScheme);
  if (state.targetState !== "unique") parameters.set("targets", state.targetState);
  if (state.theme !== "neutral") parameters.set("theme", state.theme);
  return `?${parameters}`;
}

function writeSearch(
  state: Pick<WorkshopState, "colorScheme" | "story" | "targetState" | "theme">,
): void {
  const next = `${window.location.pathname}${searchFromState(state)}`;
  window.history.replaceState(null, "", next);
}

const groups = [...new Set(stories.map((story) => story.group))];

const providers = [
  { id: "route53", name: "Amazon Route 53" },
  { id: "bluehost", name: "Bluehost" },
  { id: "cloudflare", name: "Cloudflare" },
  { id: "digitalocean", name: "DigitalOcean" },
  { id: "dnsimple", name: "DNSimple" },
  { id: "dreamhost", name: "DreamHost" },
  { id: "dynadot", name: "Dynadot" },
  { id: "gandi", name: "Gandi" },
  { id: "godaddy", name: "GoDaddy" },
  { id: "google", name: "Google Cloud DNS" },
  { id: "hostgator", name: "HostGator" },
  { id: "hostinger", name: "Hostinger" },
  { id: "hover", name: "Hover" },
  { id: "ionos", name: "IONOS" },
  { id: "namecom", name: "Name.com" },
  { id: "namecheap", name: "Namecheap" },
  { id: "netlify", name: "Netlify" },
  { id: "ns1", name: "NS1" },
  { id: "ovh", name: "OVHcloud" },
  { id: "porkbun", name: "Porkbun" },
  { id: "spaceship", name: "Spaceship" },
  { id: "squarespace", name: "Squarespace" },
  { id: "vercel", name: "Vercel" },
] as const;

const providerNames: Record<string, string> = Object.fromEntries(
  providers.map((provider) => [provider.id, provider.name]),
);

const usesDomain = (story: StoryId): boolean => story !== "provider";
const usesRecords = (story: StoryId): boolean =>
  story === "card" ||
  story === "host-lifecycle" ||
  story === "lifecycle" ||
  story === "records" ||
  story === "verification";

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const recordLeaf = (
  value: unknown,
): { name: string; priority: string; type: string; value: string } | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const leaf = value as Record<string, unknown>;
  if (
    typeof leaf.name !== "string" ||
    typeof leaf.type !== "string" ||
    typeof leaf.value !== "string"
  ) {
    return undefined;
  }
  return {
    name: leaf.name,
    priority: typeof leaf.priority === "string" ? leaf.priority : "",
    type: leaf.type,
    value: leaf.value,
  };
};

const toDnsRecord = (
  id: string,
  leaf: { name: string; priority: string; type: string; value: string },
): Transport.DnsRecord => {
  const priority = Number.parseInt(leaf.priority, 10);
  if (leaf.priority.trim() === "" || !Number.isFinite(priority)) {
    return { id, name: leaf.name, type: leaf.type, value: leaf.value };
  }
  return { id, name: leaf.name, priority, type: leaf.type, value: leaf.value };
};

const recordsFromDial = (
  ids: ReadonlyArray<string>,
  folder: unknown,
  seeds: Readonly<Record<string, Transport.DnsRecord>>,
): ReadonlyArray<Transport.DnsRecord> => {
  const values =
    typeof folder === "object" && folder !== null ? (folder as Record<string, unknown>) : {};
  return ids.map((id) => {
    const leaf = recordLeaf(values[id]);
    if (leaf !== undefined) return toDnsRecord(id, leaf);
    const seed = seeds[id];
    return seed ?? { id, name: "example.com", type: "TXT", value: "v=spf1 -all" };
  });
};

const recordFolder = (record: Transport.DnsRecord): DialConfig => ({
  _collapsed: true,
  type: { type: "text", default: record.type },
  name: { type: "text", default: record.name },
  value: { type: "text", default: record.value },
  priority: {
    type: "text",
    default: record.priority === undefined ? "" : String(record.priority),
    placeholder: "optional",
  },
  remove: { type: "action", label: "Remove" },
});

const storyConfig = ({
  initial,
  recordIds,
  seeds,
  story,
}: {
  readonly initial: WorkshopState;
  readonly recordIds: ReadonlyArray<string>;
  readonly seeds: Readonly<Record<string, Transport.DnsRecord>>;
  readonly story: StoryId;
}): DialConfig => {
  const config: DialConfig = {};
  if (usesDomain(story)) {
    config.domain = { type: "text", default: initial.domain };
  }
  if (story === "lifecycle") {
    config.receipt = {
      type: "select",
      options: [
        { label: "Present", value: "on" },
        { label: "None", value: "off" },
      ],
      default: initial.receipt ? "on" : "off",
    };
  }
  if (story === "provider") {
    config.providerId = {
      type: "select",
      options: providers.map((provider) => ({ label: provider.name, value: provider.id })),
      default: initial.providerId,
    };
    config.providerName = { type: "text", default: initial.providerName };
  }
  if (story === "connection" || story === "host-connection") {
    config.targetState = {
      type: "select",
      options: [
        { label: "Unique target", value: "unique" },
        { label: "Ambiguous targets", value: "ambiguous" },
        { label: "Unavailable targets", value: "unavailable" },
      ],
      default: initial.targetState,
    };
  }
  if (usesRecords(story)) {
    const records: DialConfig = {};
    for (const id of recordIds) {
      const seed = seeds[id] ?? { id, name: "example.com", type: "TXT", value: "v=spf1 -all" };
      records[id] = recordFolder(seed);
    }
    records.add = { type: "action", label: "Add record" };
    config.records = records;
  }
  return config;
};

function makeTransport(
  state: Pick<WorkshopState, "domain" | "providerId" | "providerName" | "story" | "targetState">,
  records: () => ReadonlyArray<Transport.DnsRecord>,
) {
  const provider = Testing.provider({
    authentication:
      state.providerId === "vercel"
        ? [
            { _tag: "Integration", label: "Install Vercel Integration" },
            { _tag: "Token", label: "Connect with token", placeholder: "Paste API token" },
          ]
        : Testing.provider().authentication,
    id: state.providerId,
    name: state.providerName,
  });
  const targets =
    state.targetState === "unavailable"
      ? []
      : [
          Testing.target({
            evidence: {
              accountName: "Arya Labs",
              nameservers: [],
              status: "active",
              zoneType: "full",
            },
          }),
          ...(state.targetState === "ambiguous"
            ? [
                Testing.target({
                  accountId: "team-2",
                  accountKind: "team",
                  evidence: {
                    accountName: "Samva Team",
                    nameservers: [],
                    status: "active",
                    zoneType: "full",
                  },
                  zoneId: "zone-2",
                }),
              ]
            : []),
        ];
  const transport = Testing.makeFakeTransport({
    cleanupPlan: {
      _tag: "CleanupPlan",
      digest: "cleanup-digest-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      operations: [],
    } satisfies Transport.CleanupPlan,
    detach: {
      _tag: "Detached",
      attachment: Testing.attachment({
        connectionId: "connection-1",
        domain: DomainName.parse(state.domain),
        target: targets[0] ?? Testing.target(),
      }),
      connection: Testing.connection({ providerId: state.providerId }),
      remainingAttachments: 0,
    },
    inspect:
      state.story === "lifecycle" || state.story === "host-lifecycle"
        ? {
            ...Testing.connected({
              attachment: Testing.attachment({
                domain: DomainName.parse(state.domain),
                target: targets[0] ?? Testing.target(),
              }),
              connection: Testing.connection({ providerId: state.providerId }),
            }),
            provider,
          }
        : {
            _tag: "Disconnected",
            domain: state.domain,
            provider,
            reusableConnections: [
              {
                connection: Testing.connection({ providerId: state.providerId }),
                targets,
              },
            ],
          },
  });
  return Transport.layerFromAsync({
    ...transport,
    cleanup: {
      apply: transport.cleanup.apply,
      plan: async (input: Parameters<typeof transport.cleanup.plan>[0]) => {
        const planned = await transport.cleanup.plan(input);
        if (planned._tag !== "CleanupPlan") return planned;
        return {
          ...planned,
          operations: records().map((record) => ({
            _tag: "Delete" as const,
            id: `delete-${record.id}`,
            record,
          })),
        };
      },
    },
  });
}

function HostConnectionRow({ domain }: { readonly domain: string }) {
  const controller = Connection.useController(domain);
  const state = controller.state;
  const snapshot =
    state._tag === "Disconnected"
      ? state
      : state._tag === "Submitting" || state._tag === "Redirecting"
        ? state.snapshot
        : undefined;
  return (
    <Connection.Root status={state._tag}>
      {snapshot === undefined ? (
        <Connection.Status state={state} />
      ) : (
        <div data-workshop-host-row="">
          <div data-workshop-host-identity="">
            <Provider.Mark provider={snapshot.provider} />
            <div>
              <strong>{snapshot.provider.name}</strong>
              <p>Manages DNS for this domain.</p>
            </div>
          </div>
          <BaseDialog.Root>
            <Connection.Trigger render={<button data-workshop-host-button="" type="button" />}>
              Connect {snapshot.provider.name}
            </Connection.Trigger>
            <Connection.Dialog controller={controller} snapshot={snapshot} />
          </BaseDialog.Root>
        </div>
      )}
    </Connection.Root>
  );
}

function HostLifecycleRow({
  domain,
  initialReceiptId,
  records,
}: {
  readonly domain: string;
  readonly initialReceiptId?: string;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
}) {
  const controller = Connection.useController(domain);
  const connection = controller.state;
  const [appliedReceiptId, setAppliedReceiptId] = useState<string>();
  if (connection._tag !== "Connected") {
    return <Connection.Status state={connection} />;
  }
  const receiptId = appliedReceiptId ?? initialReceiptId;
  return (
    <Connection.Root status={connection._tag}>
      <div data-workshop-host-row="">
        <div data-workshop-host-identity="">
          <Provider.Mark provider={connection.provider} />
          <div>
            <strong>{connection.provider.name}</strong>
            <p>Connected</p>
          </div>
        </div>
        <div data-workshop-host-actions="">
          {receiptId === undefined ? null : (
            <Cleanup.Flow
              connection={connection}
              receiptId={receiptId}
              style={{ display: "contents" }}
            />
          )}
          <Connection.DisconnectDialog connection={connection} controller={controller} />
          <Provisioning.Flow
            connection={connection}
            onApplied={(result) => setAppliedReceiptId(result.receiptId)}
            records={records}
            showRecords={false}
            style={{ display: "contents" }}
          />
        </div>
      </div>
    </Connection.Root>
  );
}

function Preview({ state }: { readonly state: WorkshopState }) {
  const [event, setEvent] = useState<Lifecycle.Event>();
  useEffect(() => {
    if (event === undefined) return;
    const timeout = window.setTimeout(() => setEvent(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [event]);
  const { domain, providerId, providerName, story, targetState } = state;
  const records = useRef(state.records);
  records.current = state.records;
  const transport = useMemo(
    () =>
      makeTransport(
        { domain, providerId, providerName, story, targetState },
        () => records.current,
      ),
    [domain, providerId, providerName, story, targetState],
  );
  const provider = Testing.provider({ id: state.providerId, name: state.providerName });
  let children: ReactNode;
  switch (state.story) {
    case "connection":
      children = <Connection.Flow domain={state.domain} />;
      break;
    case "host-connection":
      children = (
        <div data-workshop-stack="">
          <HostConnectionRow domain={state.domain} />
          <div data-workshop-narrow="">
            <HostConnectionRow domain={state.domain} />
          </div>
        </div>
      );
      break;
    case "host-lifecycle":
      children = (
        <HostLifecycleRow
          domain={state.domain}
          {...(state.receipt ? { initialReceiptId: "receipt-1" } : {})}
          records={state.records}
        />
      );
      break;
    case "lifecycle":
      children = (
        <Domain.Flow
          domain={state.domain}
          {...(state.receipt ? { receiptId: "receipt-1" } : {})}
          records={state.records}
        />
      );
      break;
    case "provider":
      children = (
        <div data-workshop-spot="">
          <Provider.Mark provider={provider} />
        </div>
      );
      break;
    case "records":
      children = (
        <div data-workshop-stack="">
          <Records.ZoneFile domain={state.domain} records={state.records} />
          <Records.Table
            evidence={state.records.map((record) => ({
              _tag: "Found" as const,
              recordId: record.id,
            }))}
            records={state.records}
          />
        </div>
      );
      break;
    case "card":
      children = (
        <div data-workshop-stack="">
          {state.records.map((record) => (
            <Records.Card
              evidence={[{ _tag: "Found", recordId: record.id }]}
              key={record.id}
              record={record}
            />
          ))}
        </div>
      );
      break;
    case "verification":
      children = <Verification.Status config={{ domain: state.domain, records: state.records }} />;
      break;
    default: {
      const _exhaustive: never = state.story;
      return _exhaustive;
    }
  }
  return (
    <DomainKit.Root
      colorScheme={state.colorScheme}
      icons={workshopIcons}
      onEvent={setEvent}
      theme={workshopTheme(state.theme, state.colorScheme)}
      transport={transport}
    >
      {children}
      {event === undefined ? null : (
        <div data-workshop-notification="" role="status">
          {workshopEventMessage(event)}
        </div>
      )}
    </DomainKit.Root>
  );
}

function workshopEventMessage(event: Lifecycle.Event): string {
  switch (event._tag) {
    case "ConnectionEstablished":
      return `${event.connection.provider.name} connected`;
    case "DomainDetached":
      return "Domain detached";
    case "RecordsApplied":
      return "DNS records added";
    case "RecordsCleaned":
      return "DNS records removed";
    case "RecordsPartiallyApplied":
      return "Some DNS records could not be added";
    case "RecordsPartiallyCleaned":
      return "Some DNS records could not be removed";
  }
}

export function Workshop({ initial }: { readonly initial: WorkshopState }) {
  const [story, setStory] = useState(initial.story);
  const [colorScheme, setColorScheme] = useState(initial.colorScheme);
  const [theme, setTheme] = useState(initial.theme);
  const [recordIds, setRecordIds] = useState(() => initial.records.map((record) => record.id));
  const nextRecord = useRef(initial.records.length + 1);
  const seeds = useRef<Record<string, Transport.DnsRecord>>(
    Object.fromEntries(initial.records.map((record) => [record.id, record])),
  );
  const lastProviderId = useRef(initial.providerId);
  const current = stories.find((item) => item.id === story) ?? stories[0];
  if (current === undefined) throw new Error("DomainKit workshop story is missing");
  const config = useMemo(
    () =>
      storyConfig({
        initial,
        recordIds,
        seeds: seeds.current,
        story,
      }),
    [initial, recordIds, story],
  );
  const dial = useDialKitController("Story", config, {
    id: "workshop-story",
    onAction: (path) => {
      if (path === "records.add") {
        const allocated = nextRecordId(seeds.current, nextRecord.current);
        const id = allocated.id;
        nextRecord.current = allocated.next;
        seeds.current[id] = {
          id,
          name: "example.com",
          type: "TXT",
          value: "v=spf1 -all",
        };
        setRecordIds((ids) => [...ids, id]);
        return;
      }
      const removed = /^records\.([^.]+)\.remove$/.exec(path);
      if (removed === null) return;
      const id = removed[1];
      if (id === undefined) return;
      setRecordIds((ids) => ids.filter((candidate) => candidate !== id));
    },
  });
  const values = dial.values as Record<string, unknown>;
  const providerId = asString(values.providerId, initial.providerId);
  const state: WorkshopState = {
    colorScheme,
    domain: asString(values.domain, initial.domain),
    providerId,
    providerName: asString(values.providerName, initial.providerName),
    receipt: asString(values.receipt, initial.receipt ? "on" : "off") === "on",
    records: recordsFromDial(recordIds, values.records, seeds.current),
    story,
    targetState:
      asString(values.targetState, initial.targetState) === "ambiguous"
        ? "ambiguous"
        : asString(values.targetState, initial.targetState) === "unavailable"
          ? "unavailable"
          : "unique",
    theme,
  };

  useEffect(() => {
    writeSearch({
      colorScheme: state.colorScheme,
      story: state.story,
      targetState: state.targetState,
      theme: state.theme,
    });
  }, [state.colorScheme, state.story, state.targetState, state.theme]);

  useEffect(() => {
    if (story !== "provider" || providerId === lastProviderId.current) return;
    lastProviderId.current = providerId;
    const name = providerNames[providerId];
    if (name !== undefined) dial.setValue("providerName", name);
  }, [dial, providerId, story]);

  return (
    <div data-scheme={state.colorScheme} data-workshop="">
      <nav aria-label="Stories" data-react-grab-ignore="" data-workshop-sidebar="">
        <div data-workshop-brand="">DomainKit</div>
        {groups.map((group) => (
          <div data-workshop-group="" key={group}>
            <p>{group}</p>
            {stories
              .filter((item) => item.group === group)
              .map((item) => (
                <button
                  aria-current={item.id === story ? "page" : undefined}
                  data-workshop-story=""
                  key={item.id}
                  onClick={() => setStory(item.id)}
                  type="button"
                >
                  {item.title}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <div data-workshop-stage="">
        <div data-react-grab-ignore="" data-workshop-toolbar="">
          <span>
            {current.group} / {current.title}
          </span>
          <div data-workshop-appearance="">
            <ToolbarSelect
              label="Color scheme"
              onValueChange={(selected) => setColorScheme(selected === "dark" ? "dark" : "light")}
              options={[
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
              ]}
              value={colorScheme}
            />
            <ToolbarSelect
              label="Theme"
              onValueChange={(selected) => {
                if (isWorkshopThemeId(selected)) setTheme(selected);
              }}
              options={workshopThemePresets.map((preset) => ({
                label: preset.label,
                value: preset.id,
              }))}
              value={theme}
            />
          </div>
        </div>
        <div data-workshop-canvas="">
          <div data-workshop-frame="">
            <Preview
              key={`${state.story}:${state.domain}:${state.providerId}:${state.providerName}:${state.receipt}:${state.targetState}`}
              state={state}
            />
          </div>
        </div>
      </div>
      <section aria-label="Workshop controls" data-workshop-addons="">
        <DialRoot mode="inline" productionEnabled theme={state.colorScheme} />
      </section>
    </div>
  );
}
