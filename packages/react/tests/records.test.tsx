import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Records } from "../src/index.ts";

afterEach(cleanup);

const records: ReadonlyArray<Records.DnsRecord> = [
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

describe("Records primitives", () => {
  it("exposes copy state to custom host UI", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    const CustomCopy = () => {
      const controller = Records.useCopy("custom-value");
      return (
        <button onClick={controller.copy}>{controller.copied ? "Copied" : "Copy custom"}</button>
      );
    };
    render(<CustomCopy />);
    await userEvent.click(screen.getByRole("button", { name: "Copy custom" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("renders a table without DomainKit.Root", () => {
    render(<Records.Table records={records} />);
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "MX" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy mail.example.com" })).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Copy mail.example.com" })[0]?.querySelector("svg"),
    ).toBeTruthy();
  });

  it("copies a value through the clipboard", async () => {
    const user = userEvent.setup();
    const writes: Array<string> = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          writes.push(value);
        },
      },
    });
    render(<Records.CopyValue copyIcon={<span>host-copy</span>} value="v=spf1 -all" />);
    expect(screen.getByText("host-copy")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy v=spf1 -all" }));
    expect(writes).toEqual(["v=spf1 -all"]);
    expect(await screen.findByRole("button", { name: "Copied v=spf1 -all" })).toBeTruthy();
  });

  it("copies and downloads a zone file", async () => {
    const user = userEvent.setup();
    const writes: Array<string> = [];
    const downloads: Array<{ filename: string; href: string }> = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          writes.push(value);
        },
      },
    });
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:zone";
    URL.revokeObjectURL = () => undefined;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      downloads.push({ filename: this.download, href: this.href });
    };
    try {
      render(<Records.ZoneFile domain="mail.example.com" records={records} />);
      await user.click(screen.getByRole("button", { name: "Copy zone" }));
      await user.click(screen.getByRole("button", { name: "Download" }));
      expect(writes).toEqual([Records.toZoneFile(records)]);
      expect(downloads).toEqual([{ filename: "mail.example.com.txt", href: "blob:zone" }]);
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it("exports absolute, import-safe BIND records", () => {
    expect(Records.toZoneFile(records)).toBe(
      'mail.example.com. IN MX 10 feedback-smtp.example.net.\nmail.example.com. IN TXT "v=spf1 include:example.net ~all"\n',
    );
    expect(
      Records.toZoneFile([
        {
          id: "quoted-txt",
          name: "example.com",
          type: "TXT",
          value: 'contains "quotes" and \\slashes',
        },
      ]),
    ).toBe('example.com. IN TXT "contains \\"quotes\\" and \\\\slashes"\n');
    expect(
      Records.toZoneFile([
        {
          id: "control-txt",
          name: "example.com",
          type: "TXT",
          value: "line one\nline two\tend",
        },
      ]),
    ).toBe('example.com. IN TXT "line one\\010line two\\009end"\n');
    expect(
      Records.toZoneFile([
        {
          id: "long-txt",
          name: "example.com",
          type: "TXT",
          value: "a".repeat(256),
        },
      ]),
    ).toBe(`example.com. IN TXT "${"a".repeat(255)}" "a"\n`);
    expect(
      Records.toZoneFile([
        {
          id: "srv",
          name: "_service._tcp.example.com",
          priority: 10,
          type: "SRV",
          value: "5 443 service.example.net",
        },
      ]),
    ).toBe("_service._tcp.example.com. IN SRV 10 5 443 service.example.net.\n");
  });

  it("renders optional status chips and stacked cards", () => {
    const mx = records[0];
    const evidence: ReadonlyArray<Records.ObservationEvidence> = [
      { _tag: "Found", recordId: "mx" },
      { _tag: "Mismatch", recordId: "spf", message: "value differs" },
    ];
    if (mx === undefined) throw new Error("expected mx record");
    render(
      <>
        <Records.Table evidence={evidence} records={records} />
        <Records.Card evidence={evidence} record={mx} />
      </>,
    );
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.getAllByText("Found").length).toBeGreaterThan(0);
    expect(screen.getByText("Mismatch")).toBeTruthy();
    expect(screen.getAllByText("Priority 10").length).toBeGreaterThan(0);
  });

  it("composes table parts and lets Status children replace the tag", () => {
    render(
      <Records.Root>
        <Records.Header>
          <Records.Row>
            <Records.Head scope="col">Type</Records.Head>
            <Records.Head data-column="status" scope="col">
              Status
            </Records.Head>
          </Records.Row>
        </Records.Header>
        <Records.Body>
          <Records.Row>
            <Records.Cell>MX</Records.Cell>
            <Records.Cell data-column="status">
              <Records.Status evidence={{ _tag: "Found", recordId: "mx" }}>Live</Records.Status>
            </Records.Cell>
          </Records.Row>
        </Records.Body>
      </Records.Root>,
    );
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText("Found")).toBeNull();
  });
});
