import { DnsRecord, type Plan } from "domainkit";
import type { Transport } from "domainkit/client";
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { leafPart, usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { useIcons } from "./icons.tsx";

export type Readiness = Transport.Readiness;
export type RequirementStatus = Readiness["requirements"][number]["status"];

// ---------------------------------------------------------------------------------------------
// Zone file
// ---------------------------------------------------------------------------------------------

const absolute = (value: string): string => (value.endsWith(".") ? value : `${value}.`);

const textEncoder = new TextEncoder();

const escapeTxtCharacter = (character: string): string => {
  if (character === '"' || character === "\\") return `\\${character}`;
  const codePoint = character.codePointAt(0);
  if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
    return `\\${codePoint.toString().padStart(3, "0")}`;
  }
  return character;
};

/** TXT strings are capped at 255 bytes each, so long values are split and quoted per chunk. */
const txtValue = (value: string): string => {
  const chunks: Array<string> = [];
  let chunk = "";
  let byteLength = 0;
  for (const character of value) {
    const characterByteLength = textEncoder.encode(character).byteLength;
    if (byteLength + characterByteLength > 255) {
      chunks.push(chunk);
      chunk = "";
      byteLength = 0;
    }
    chunk += escapeTxtCharacter(character);
    byteLength += characterByteLength;
  }
  chunks.push(chunk);
  return chunks.map((part) => `"${part}"`).join(" ");
};

/** The RR type as a zone file spells it. The tag and the type name are the same string. */
const rrType = (record: DnsRecord.Model): string => record._tag;

const zoneData = (record: DnsRecord.Model): string => {
  switch (record._tag) {
    case "A":
    case "AAAA":
      return record.address;
    case "CNAME":
      return absolute(record.target);
    case "NS":
      return absolute(record.nameserver);
    case "TXT":
      return txtValue(record.value);
    case "MX":
      return `${record.priority} ${absolute(record.exchange)}`;
    case "CAA":
      return `${record.flags} ${record.tag} "${record.value}"`;
    case "SRV":
      return `${record.priority} ${record.weight} ${record.port} ${absolute(record.target)}`;
  }
};

export const toZoneFile = (records: ReadonlyArray<DnsRecord.Model>): string =>
  `${records
    .map(
      (record) =>
        `${absolute(record.name)}${record.ttl === null ? "" : ` ${record.ttl}`} IN ${rrType(record)} ${zoneData(record)}`,
    )
    .join("\n")}\n`;

const downloadText = (filename: string, contents: string): void => {
  if (typeof document === "undefined") return;
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const downloadZoneFile = (domain: string, records: ReadonlyArray<DnsRecord.Model>): void =>
  downloadText(`${domain}.txt`, toZoneFile(records));

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

export const copyText = (value: string): Promise<boolean> => {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    return Promise.resolve(false);
  }
  return navigator.clipboard.writeText(value).then(
    () => true,
    () => false,
  );
};

export interface CopyController {
  readonly copied: boolean;
  readonly copy: () => void;
}

export function useCopy(value: string, resetAfter = 2000): CopyController {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  return {
    copied,
    copy: () => {
      void copyText(value).then((ok) => {
        if (!ok) return;
        setCopied(true);
        clearTimeout(reset.current);
        reset.current = setTimeout(() => setCopied(false), resetAfter);
      });
    },
  };
}

export interface CopyValueProps extends PartProps<"span", { readonly copied: boolean }> {
  readonly value: string;
}

export function CopyValue({ value, ...props }: CopyValueProps) {
  const { messages } = useDomainKit();
  const icons = useIcons();
  const { copied, copy } = useCopy(value);
  return usePart(
    "span",
    props,
    { copied },
    {
      children: (
        <>
          <code>{value}</code>
          <button
            aria-label={`${copied ? messages.copied : messages.copy} ${value}`}
            data-domainkit-part="copy-action"
            onClick={copy}
            type="button"
          >
            <span
              aria-hidden="true"
              data-domainkit-part="copy-glyph"
              data-icon=""
              data-state="idle"
            >
              {icons.copy}
            </span>
            <span
              aria-hidden="true"
              data-domainkit-part="copy-glyph"
              data-icon=""
              data-state="done"
            >
              {icons.copied}
            </span>
          </button>
        </>
      ),
      "data-copied": copied ? "" : undefined,
      "data-domainkit-part": "copy-value",
    },
  );
}

export interface ZoneFileProps extends PartProps<"div", { readonly count: number }> {
  readonly domain: string;
  readonly records: ReadonlyArray<DnsRecord.Model>;
}

export function ZoneFile({ domain, records, ...props }: ZoneFileProps) {
  const { messages } = useDomainKit();
  const icons = useIcons();
  const zone = toZoneFile(records);
  const { copied, copy } = useCopy(zone);
  return usePart(
    "div",
    props,
    { count: records.length },
    {
      children: (
        <>
          <button
            aria-label={copied ? messages.copied : messages.copyZone}
            data-domainkit-part="zone-copy"
            onClick={copy}
            type="button"
          >
            <span aria-hidden="true" data-icon="inline-start">
              {copied ? icons.copied : icons.copy}
            </span>
            {copied ? messages.copied : messages.copyZone}
          </button>
          <button
            aria-label={messages.download}
            data-domainkit-part="zone-download"
            onClick={() => downloadZoneFile(domain, records)}
            type="button"
          >
            <span aria-hidden="true" data-icon="inline-start">
              {icons.download}
            </span>
            {messages.download}
          </button>
        </>
      ),
      "data-domainkit-part": "zone-file",
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/**
 * What a row has to say about one record: while a plan is pending it is what the plan will do to
 * it, and otherwise what the last observation read back.
 */
export type Standing =
  | { readonly _tag: "Operation"; readonly operation: Plan.Operation }
  | { readonly _tag: "Readiness"; readonly status: RequirementStatus };

export interface Sources {
  /** A plan still awaiting its apply. Pass `null` once one has landed; readiness answers then. */
  readonly plan?: Plan.Model | null | undefined;
  readonly readiness?: Readiness | null | undefined;
}

/** The row's standing, or `null` when neither a plan nor an observation covers the record. */
export const statusOf = (record: DnsRecord.Model, sources: Sources): Standing | null => {
  const operation = sources.plan?.operations.find((entry) =>
    DnsRecord.equals(entry.record, record),
  );
  if (operation !== undefined) return { _tag: "Operation", operation };
  const status = sources.readiness?.requirements.find((requirement) =>
    DnsRecord.equals(requirement.record, record),
  )?.status;
  return status === undefined ? null : { _tag: "Readiness", status };
};

export interface StatusProps extends PartProps<"span", { readonly status: RequirementStatus }> {
  readonly status: RequirementStatus;
}

export function Status({ status, ...props }: StatusProps) {
  const { messages } = useDomainKit();
  const icons = useIcons();
  const glyph =
    status === "satisfied" ? icons.success : status === "unknown" ? icons.pending : icons.failure;
  return usePart(
    "span",
    props,
    { status },
    {
      children: (
        <>
          <span aria-hidden="true" data-icon="inline-start">
            {glyph}
          </span>
          {messages.requirementStatus(status)}
        </>
      ),
      "data-domainkit-part": "record-status",
      "data-status": status,
    },
  );
}

export interface PlanStatusProps extends PartProps<
  "span",
  { readonly operation: Plan.Operation["_tag"] }
> {
  readonly operation: Plan.Operation;
}

/** What a pending plan will do to one record: add it, leave it, or nothing while it is blocked. */
export function PlanStatus({ operation, ...props }: PlanStatusProps) {
  const { messages } = useDomainKit();
  const icons = useIcons();
  const glyph =
    operation._tag === "Conflict"
      ? icons.failure
      : operation._tag === "Noop"
        ? icons.success
        : icons.pending;
  return usePart(
    "span",
    props,
    { operation: operation._tag },
    {
      children: (
        <>
          <span aria-hidden="true" data-icon="inline-start">
            {glyph}
          </span>
          {messages.planStatus(operation)}
        </>
      ),
      "data-domainkit-part": "record-status",
      "data-operation": operation._tag,
    },
  );
}

/** One row's standing, whichever of the two it is. */
function Standing({ standing }: { readonly standing: Standing }): ReactElement {
  return standing._tag === "Operation" ? (
    <PlanStatus operation={standing.operation} />
  ) : (
    <Status status={standing.status} />
  );
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

export const Columns = leafPart("thead", "records-columns");
export const Body = leafPart("tbody", "records-body");
export const Footer = leafPart("tfoot", "records-footer");
export const Row = leafPart("tr", "records-row");
export const Head = leafPart("th", "records-head");
export const Cell = leafPart("td", "records-cell");
/** Above the table rather than inside it, so the one action sits beside the name. */
export const Caption = leafPart("div", "records-caption");
export const Actions = leafPart("div", "records-actions");
export const Value = leafPart("span", "record-value");
export const Purpose = leafPart("span", "record-purpose");
export const CardHeader = leafPart("div", "record-card-head");
export const CardTitle = leafPart("strong", "record-card-title");
export const CardContent = leafPart("dl", "record-card-content");

export interface RootProps extends PartProps<"table", { readonly count: number }> {
  readonly count?: number;
  /** Names the table. Rendered in the header and read by assistive technology as its label. */
  readonly caption?: string;
  /** What the customer can do with these records; the plan's one action is what goes here. */
  readonly actions?: ReactNode;
}

export function Root({ actions, caption, count = 0, ...props }: RootProps) {
  const table = usePart(
    "table",
    props,
    { count },
    {
      "aria-label": caption,
      "data-domainkit-part": "records-table",
    },
  );
  return (
    <div data-domainkit-part="records-panel">
      {caption === undefined && actions === undefined ? null : (
        <div data-domainkit-part="records-header">
          {caption === undefined ? null : <Caption>{caption}</Caption>}
          {actions === undefined ? null : <Actions>{actions}</Actions>}
        </div>
      )}
      {table}
    </div>
  );
}

/** A stable React key for a requirement: type, name, and data identify a record. */
export const identity = (record: DnsRecord.Model): string =>
  [rrType(record), record.name, DnsRecord.data(record)].join(":");

/**
 * A requirement set keyed by everything it carries, for memos that decide whether to re-send it.
 * `identity` is deliberately narrower: it answers "is this the same record" for a React key, while
 * a plan and an observation are built from `ttl`, `policy`, and `purpose` as well. `policy` in
 * particular decides whether a name may hold anything else, so readiness turns on it.
 */
export const requirementsKey = (records: ReadonlyArray<DnsRecord.Model>): string =>
  JSON.stringify(records);

export interface CardProps extends PartProps<"section", { readonly record: string }> {
  readonly readiness?: Readiness | null;
  readonly record: DnsRecord.Model;
}

export function Card({ readiness, record, ...props }: CardProps): ReactElement {
  const { messages } = useDomainKit();
  const standing = statusOf(record, { readiness });
  return usePart(
    "section",
    props,
    { record: identity(record) },
    {
      children: (
        <>
          <CardHeader>
            <CardTitle>{messages.recordType(record)}</CardTitle>
            {standing === null ? null : <Standing standing={standing} />}
          </CardHeader>
          <CardContent>
            <div>
              <dt>{messages.headingName}</dt>
              <dd>
                <CopyValue value={record.name} />
              </dd>
            </div>
            <div>
              <dt>{messages.headingValue}</dt>
              <dd>
                <CopyValue value={DnsRecord.data(record)} />
              </dd>
            </div>
            {record.purpose === undefined ? null : (
              <div>
                <dt>{messages.headingPurpose}</dt>
                <dd>
                  <Purpose>{record.purpose}</Purpose>
                </dd>
              </div>
            )}
          </CardContent>
        </>
      ),
      "data-domainkit-part": "record-card",
    },
  );
}

export interface TableProps extends PartProps<"table", { readonly count: number }> {
  readonly caption?: string;
  /** A plan awaiting its apply. Its operations become the status column; `null` after one lands. */
  readonly plan?: Plan.Model | null;
  readonly readiness?: Readiness | null;
  readonly records: ReadonlyArray<DnsRecord.Model>;
  /** Rendered in the header beside the caption. `Provision.Action` is what the flow puts here. */
  readonly actions?: ReactNode;
}

/**
 * The default records presentation: one row per requirement, and a status column that reads the
 * plan while one is pending and the last observation after that. A conflict explains itself in a
 * row under the record it blocks, because that is where the customer can act on it.
 */
export function Table({
  actions,
  caption,
  plan,
  readiness,
  records,
  ...props
}: TableProps): ReactElement {
  const { messages } = useDomainKit();
  const withStatus =
    (plan !== null && plan !== undefined) || (readiness !== null && readiness !== undefined);
  const columns = withStatus ? 4 : 3;
  return (
    <Root
      count={records.length}
      {...(actions === undefined ? {} : { actions })}
      {...(caption === undefined ? {} : { caption })}
      {...props}
    >
      <Columns>
        <Row>
          <Head scope="col">{messages.headingType}</Head>
          <Head scope="col">{messages.headingName}</Head>
          <Head scope="col">{messages.headingValue}</Head>
          {withStatus ? (
            <Head data-column="status" scope="col">
              {messages.headingStatus}
            </Head>
          ) : null}
        </Row>
      </Columns>
      <Body>
        {records.map((record) => {
          const standing = statusOf(record, { plan, readiness });
          const conflict =
            standing?._tag === "Operation" && standing.operation._tag === "Conflict"
              ? standing.operation
              : null;
          return (
            <Fragment key={identity(record)}>
              <Row>
                <Cell>{messages.recordType(record)}</Cell>
                <Cell>
                  <CopyValue value={record.name} />
                </Cell>
                <Cell>
                  <Value>
                    <CopyValue value={DnsRecord.data(record)} />
                    {record.purpose === undefined ? null : <Purpose>{record.purpose}</Purpose>}
                  </Value>
                </Cell>
                {withStatus ? (
                  <Cell data-column="status">
                    {standing === null ? null : <Standing standing={standing} />}
                  </Cell>
                ) : null}
              </Row>
              {conflict === null ? null : (
                <Row data-domainkit-part="record-conflict" data-reason={conflict.reason}>
                  <Cell colSpan={columns}>
                    <span data-domainkit-part="record-conflict-reason">
                      {messages.conflictReason(conflict.reason)}
                    </span>{" "}
                    <span data-domainkit-part="record-conflict-advice">
                      {messages.conflictAdvice(conflict.reason)}
                    </span>
                  </Cell>
                </Row>
              )}
            </Fragment>
          );
        })}
      </Body>
    </Root>
  );
}
