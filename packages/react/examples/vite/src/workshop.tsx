import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Copy01Icon, Download01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DialRoot, useDialKitController, type DialConfig } from "dialkit";
import { Transport } from "domainkit";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Cleanup,
  Connection,
  Domain,
  DomainKit,
  Provisioning,
  Provider,
  Records,
  Testing,
  Verification,
} from "../../../src/index.ts";

import { nextRecordId } from "./workshop-records.ts";

const brandTheme = {
  accent: "#7c3aed",
  accentContrast: "#ffffff",
  fontFamily: "Inter, ui-sans-serif, system-ui",
  radius: "1rem",
} as const;

const workshopIcons = {
  copied: <HugeiconsIcon icon={Tick02Icon} />,
  copy: <HugeiconsIcon icon={Copy01Icon} />,
  download: <HugeiconsIcon icon={Download01Icon} />,
};

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
  readonly branded: boolean;
  readonly colorScheme: "dark" | "light";
  readonly domain: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly receipt: boolean;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly story: StoryId;
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
  return {
    branded: parameters.get("theme") === "brand",
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
  };
}

function searchFromState(state: Pick<WorkshopState, "branded" | "colorScheme" | "story">): string {
  const parameters = new URLSearchParams();
  parameters.set("story", state.story);
  if (state.story === "lifecycle") parameters.set("flow", "lifecycle");
  parameters.set("mode", state.colorScheme);
  if (state.branded) parameters.set("theme", "brand");
  return `?${parameters}`;
}

function writeSearch(state: Pick<WorkshopState, "branded" | "colorScheme" | "story">): void {
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

const controlsConfig = ({
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
  const config: DialConfig = {
    colorScheme: {
      type: "select",
      options: [
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" },
      ],
      default: initial.colorScheme,
    },
    theme: {
      type: "select",
      options: [
        { label: "Default", value: "default" },
        { label: "Brand", value: "brand" },
      ],
      default: initial.branded ? "brand" : "default",
    },
  };
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
  state: Pick<WorkshopState, "domain" | "providerId" | "providerName" | "story">,
  records: () => ReadonlyArray<Transport.DnsRecord>,
) {
  const provider = Testing.provider({ id: state.providerId, name: state.providerName });
  const transport = Testing.makeFakeTransport({
    cleanupPlan: {
      _tag: "CleanupPlan",
      digest: "cleanup-digest-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      operations: [],
    } satisfies Transport.CleanupPlan,
    inspect:
      state.story === "lifecycle" || state.story === "host-lifecycle"
        ? {
            _tag: "Connected",
            connectionId: "connection-1",
            domain: state.domain,
            provider,
          }
        : {
            _tag: "Disconnected",
            domain: state.domain,
            provider,
            reusableConnection: { connectionId: "connection-1", label: "Arya Labs account" },
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
  const connection = Connection.useController(domain).state;
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
          <Connection.DisconnectAction connection={connection} style={{ display: "contents" }} />
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
  const { domain, providerId, providerName, story } = state;
  const records = useRef(state.records);
  records.current = state.records;
  const transport = useMemo(
    () => makeTransport({ domain, providerId, providerName, story }, () => records.current),
    [domain, providerId, providerName, story],
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
      {...(state.branded ? { theme: brandTheme } : {})}
      transport={transport}
    >
      {children}
    </DomainKit.Root>
  );
}

const constrainSelectDropdown = (root: HTMLElement, dropdown: HTMLElement): void => {
  const gap = 4;
  const trigger = root.querySelector<HTMLElement>(".dialkit-select-trigger[data-open='true']");
  if (trigger === null) return;
  const rootBox = root.getBoundingClientRect();
  const triggerBox = trigger.getBoundingClientRect();
  const spaceBelow = Math.max(0, rootBox.bottom - triggerBox.bottom - gap);
  const spaceAbove = Math.max(0, triggerBox.top - rootBox.top - gap);
  const above = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(280, Math.max(120, above ? spaceAbove : spaceBelow));
  dropdown.style.maxHeight = `${maxHeight}px`;
  dropdown.style.overflowY = "auto";
  dropdown.style.overscrollBehavior = "contain";
  const height = Math.min(maxHeight, dropdown.scrollHeight);
  const top = above
    ? triggerBox.top - rootBox.top - height - gap
    : triggerBox.bottom - rootBox.top + gap;
  dropdown.style.top = `${Math.max(8, top)}px`;
};

export function Workshop({ initial }: { readonly initial: WorkshopState }) {
  const addons = useRef<HTMLElement>(null);
  const [story, setStory] = useState(initial.story);
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
      controlsConfig({
        initial,
        recordIds,
        seeds: seeds.current,
        story,
      }),
    [initial, recordIds, story],
  );
  const dial = useDialKitController("Controls", config, {
    id: "workshop",
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
  const colorScheme =
    asString(values.colorScheme, initial.colorScheme) === "dark" ? "dark" : "light";
  const branded = asString(values.theme, initial.branded ? "brand" : "default") === "brand";
  const providerId = asString(values.providerId, initial.providerId);
  const state: WorkshopState = {
    branded,
    colorScheme,
    domain: asString(values.domain, initial.domain),
    providerId,
    providerName: asString(values.providerName, initial.providerName),
    receipt: asString(values.receipt, initial.receipt ? "on" : "off") === "on",
    records: recordsFromDial(recordIds, values.records, seeds.current),
    story,
  };

  useEffect(() => {
    writeSearch({ branded: state.branded, colorScheme: state.colorScheme, story: state.story });
  }, [state.branded, state.colorScheme, state.story]);

  useEffect(() => {
    if (story !== "provider" || providerId === lastProviderId.current) return;
    lastProviderId.current = providerId;
    const name = providerNames[providerId];
    if (name !== undefined) dial.setValue("providerName", name);
  }, [dial, providerId, story]);

  useEffect(() => {
    const host = addons.current;
    if (host === null) return;
    const attach = (dropdown: HTMLElement) => {
      const root = dropdown.closest(".dialkit-root");
      if (root instanceof HTMLElement) constrainSelectDropdown(root, dropdown);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("dialkit-select-dropdown")) {
            requestAnimationFrame(() => attach(node));
          }
        }
      }
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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
          {current.group} / {current.title}
        </div>
        <div data-workshop-canvas="">
          <div data-workshop-frame="">
            <Preview
              key={`${state.story}:${state.domain}:${state.providerId}:${state.providerName}:${state.receipt}`}
              state={state}
            />
          </div>
        </div>
      </div>
      <section aria-label="Controls" data-react-grab-ignore="" data-workshop-addons="" ref={addons}>
        <DialRoot mode="inline" productionEnabled theme={state.colorScheme} />
      </section>
    </div>
  );
}
