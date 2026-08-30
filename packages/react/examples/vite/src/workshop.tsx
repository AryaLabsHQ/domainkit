import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Connection,
  Domain,
  DomainKit,
  Provider,
  Records,
  Testing,
  Transport,
  Verification,
} from "@domainkit/react";

const brandTheme = {
  accent: "#7c3aed",
  accentContrast: "#ffffff",
  fontFamily: "Inter, ui-sans-serif, system-ui",
  radius: "1rem",
} as const;

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
  { id: "lifecycle", group: "Flows", title: "Domain" },
  { id: "records", group: "Presentational", title: "Records" },
  { id: "card", group: "Presentational", title: "Record card" },
  { id: "provider", group: "Presentational", title: "Provider mark" },
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
      state.story === "lifecycle"
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
  return {
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
  };
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
      children = <Provider.Mark provider={provider} />;
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
      {...(state.branded ? { theme: brandTheme } : {})}
      transport={transport}
    >
      {children}
    </DomainKit.Root>
  );
}

function RecordFields({
  onChange,
  records,
}: {
  readonly onChange: (records: ReadonlyArray<Transport.DnsRecord>) => void;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
}) {
  return (
    <div data-workshop-records="">
      {records.map((record) => (
        <div key={record.id}>
          <input
            aria-label={`${record.id} type`}
            onChange={(event) =>
              onChange(
                records.map((candidate) =>
                  candidate.id === record.id
                    ? { ...candidate, type: event.target.value }
                    : candidate,
                ),
              )
            }
            value={record.type}
          />
          <input
            aria-label={`${record.id} name`}
            onChange={(event) =>
              onChange(
                records.map((candidate) =>
                  candidate.id === record.id
                    ? { ...candidate, name: event.target.value }
                    : candidate,
                ),
              )
            }
            value={record.name}
          />
          <input
            aria-label={`${record.id} value`}
            onChange={(event) =>
              onChange(
                records.map((candidate) =>
                  candidate.id === record.id
                    ? { ...candidate, value: event.target.value }
                    : candidate,
                ),
              )
            }
            value={record.value}
          />
          <input
            aria-label={`${record.id} priority`}
            inputMode="numeric"
            onChange={(event) => {
              const priority = Number.parseInt(event.target.value, 10);
              onChange(
                records.map((candidate) => {
                  if (candidate.id !== record.id) return candidate;
                  if (event.target.value.trim() === "" || !Number.isFinite(priority)) {
                    return {
                      id: candidate.id,
                      name: candidate.name,
                      type: candidate.type,
                      value: candidate.value,
                    };
                  }
                  return { ...candidate, priority };
                }),
              );
            }}
            placeholder="prio"
            value={record.priority ?? ""}
          />
          <button
            onClick={() => onChange(records.filter((candidate) => candidate.id !== record.id))}
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange([
            ...records,
            {
              id: `record-${records.length + 1}`,
              name: "example.com",
              type: "TXT",
              value: "v=spf1 -all",
            },
          ])
        }
        type="button"
      >
        Add record
      </button>
    </div>
  );
}

export function Workshop({ initial }: { readonly initial: WorkshopState }) {
  const [state, setState] = useState(initial);
  const current = stories.find((story) => story.id === state.story) ?? stories[0];
  const showDomain =
    state.story === "card" ||
    state.story === "connection" ||
    state.story === "lifecycle" ||
    state.story === "records" ||
    state.story === "verification";
  const showRecords =
    state.story === "card" ||
    state.story === "lifecycle" ||
    state.story === "records" ||
    state.story === "verification";
  const update = (patch: Partial<WorkshopState>) => {
    setState((currentState) => {
      const next = { ...currentState, ...patch };
      if (
        patch.story !== undefined ||
        patch.colorScheme !== undefined ||
        patch.branded !== undefined
      ) {
        writeSearch(next);
      }
      return next;
    });
  };

  return (
    <div data-scheme={state.colorScheme} data-workshop="">
      <nav aria-label="Stories" data-workshop-sidebar="">
        <div data-workshop-brand="">DomainKit</div>
        {groups.map((group) => (
          <div data-workshop-group="" key={group}>
            <p>{group}</p>
            {stories
              .filter((story) => story.group === group)
              .map((story) => (
                <button
                  aria-current={story.id === state.story ? "page" : undefined}
                  data-workshop-story=""
                  key={story.id}
                  onClick={() => update({ story: story.id })}
                  type="button"
                >
                  {story.title}
                </button>
              ))}
          </div>
        ))}
      </nav>
      <div data-workshop-stage="">
        <div data-workshop-toolbar="">
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
      <section aria-label="Controls" data-workshop-addons="">
        <p>Controls</p>
        <div data-workshop-controls="">
          <label data-workshop-field="">
            <span>Color scheme</span>
            <select
              onChange={(event) =>
                update({ colorScheme: event.target.value === "dark" ? "dark" : "light" })
              }
              value={state.colorScheme}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label data-workshop-field="">
            <span>Theme</span>
            <select
              onChange={(event) => update({ branded: event.target.value === "brand" })}
              value={state.branded ? "brand" : "default"}
            >
              <option value="default">Default</option>
              <option value="brand">Brand</option>
            </select>
          </label>
          {showDomain ? (
            <label data-workshop-field="">
              <span>Domain</span>
              <input
                onChange={(event) => update({ domain: event.target.value })}
                value={state.domain}
              />
            </label>
          ) : null}
          {state.story === "lifecycle" ? (
            <label data-workshop-field="">
              <span>Receipt</span>
              <select
                onChange={(event) => update({ receipt: event.target.value === "on" })}
                value={state.receipt ? "on" : "off"}
              >
                <option value="on">Present</option>
                <option value="off">None</option>
              </select>
            </label>
          ) : null}
          {state.story === "provider" ? (
            <>
              <label data-workshop-field="">
                <span>Provider id</span>
                <select
                  onChange={(event) => {
                    const providerId = event.target.value;
                    update({
                      providerId,
                      providerName:
                        providerId === "cloudflare"
                          ? "Cloudflare"
                          : providerId === "vercel"
                            ? "Vercel"
                            : "Namecheap",
                    });
                  }}
                  value={state.providerId}
                >
                  <option value="cloudflare">cloudflare</option>
                  <option value="vercel">vercel</option>
                  <option value="namecheap">namecheap</option>
                </select>
              </label>
              <label data-workshop-field="">
                <span>Provider name</span>
                <input
                  onChange={(event) => update({ providerName: event.target.value })}
                  value={state.providerName}
                />
              </label>
            </>
          ) : null}
          {showRecords ? (
            <div data-span="wide" data-workshop-field="">
              <span>Records</span>
              <RecordFields onChange={(records) => update({ records })} records={state.records} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
