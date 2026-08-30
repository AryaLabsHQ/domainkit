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
  it("renders a table without DomainKit.Root", () => {
    render(<Records.Table records={records} />);
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "MX" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Copy mail.example.com" })).toHaveLength(2);
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
    render(<Records.CopyValue value="v=spf1 -all" />);
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
    expect(screen.getByText("Priority 10")).toBeTruthy();
  });
});
