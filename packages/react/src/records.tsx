import { DnsRecord } from "domainkit";
import type { Transport } from "domainkit/client";
import { useEffect, useRef, useState, type ReactElement } from "react";

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

/** The readiness this record reached, or `null` when nothing has observed it. */
export const statusOf = (
  record: DnsRecord.Model,
  readiness: Readiness | null | undefined,
): RequirementStatus | null =>
  readiness?.requirements.find((requirement) => DnsRecord.equals(requirement.record, record))
    ?.status ?? null;

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

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

export const Header = leafPart("thead", "records-header");
export const Body = leafPart("tbody", "records-body");
export const Footer = leafPart("tfoot", "records-footer");
export const Row = leafPart("tr", "records-row");
export const Head = leafPart("th", "records-head");
export const Cell = leafPart("td", "records-cell");
export const Caption = leafPart("caption", "records-caption");
export const Value = leafPart("span", "record-value");
export const Purpose = leafPart("span", "record-purpose");
export const CardHeader = leafPart("div", "record-card-head");
export const CardTitle = leafPart("strong", "record-card-title");
export const CardContent = leafPart("dl", "record-card-content");

export interface RootProps extends PartProps<"table", { readonly count: number }> {
  readonly count?: number;
}

export function Root({ count = 0, ...props }: RootProps) {
  return (
    <div data-domainkit-part="records-panel">
      {usePart("table", props, { count }, { "data-domainkit-part": "records-table" })}
    </div>
  );
}

/** A stable React key for a requirement: type, name, and data identify a record. */
export const identity = (record: DnsRecord.Model): string =>
  [rrType(record), record.name, DnsRecord.data(record)].join(":");

export interface CardProps extends PartProps<"section", { readonly record: string }> {
  readonly readiness?: Readiness | null;
  readonly record: DnsRecord.Model;
}

export function Card({ readiness, record, ...props }: CardProps): ReactElement {
  const { messages } = useDomainKit();
  const status = statusOf(record, readiness);
  return usePart(
    "section",
    props,
    { record: identity(record) },
    {
      children: (
        <>
          <CardHeader>
            <CardTitle>{messages.recordType(record)}</CardTitle>
            {status === null ? null : <Status status={status} />}
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
  readonly readiness?: Readiness | null;
  readonly records: ReadonlyArray<DnsRecord.Model>;
}

/** The default records presentation: one row per requirement, with readiness when there is any. */
export function Table({ caption, readiness, records, ...props }: TableProps): ReactElement {
  const { messages } = useDomainKit();
  const withStatus = readiness !== null && readiness !== undefined;
  return (
    <Root count={records.length} {...props}>
      {caption === undefined ? null : <Caption>{caption}</Caption>}
      <Header>
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
      </Header>
      <Body>
        {records.map((record) => {
          const status = statusOf(record, readiness);
          return (
            <Row key={identity(record)}>
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
                  {status === null ? null : <Status status={status} />}
                </Cell>
              ) : null}
            </Row>
          );
        })}
      </Body>
    </Root>
  );
}
