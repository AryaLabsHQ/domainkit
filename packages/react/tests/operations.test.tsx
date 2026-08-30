import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

import { Operations, type Records } from "../src/index.ts";

afterEach(cleanup);

const record: Records.DnsRecord = {
  id: "dkim",
  name: "selector._domainkey.example.com",
  type: "TXT",
  value: "v=DKIM1; p=public-key",
};

describe("Operations primitives", () => {
  it("renders the shared provisioning and cleanup recipe", () => {
    render(
      <>
        <Operations.List
          lifecycle="provisioning"
          operations={[{ _tag: "Conflict", id: "conflict", reason: "value differs", record }]}
        />
        <Operations.List
          lifecycle="cleanup"
          operations={[{ _tag: "Blocked", id: "blocked", reason: "ownership changed", record }]}
        />
      </>,
    );

    expect(screen.getAllByText(record.value)).toHaveLength(2);
    expect(screen.getByText("value differs")).toBeTruthy();
    expect(screen.getByText("ownership changed")).toBeTruthy();
  });

  it("preserves refs, host events, render elements, and state-aware classes", async () => {
    const events: Array<string> = [];
    const ref = createRef<HTMLUListElement>();
    const operation: Operations.Operation = { _tag: "Create", id: "create", record };
    render(
      <Operations.Root
        className={({ lifecycle }) => `host-${lifecycle}`}
        lifecycle="provisioning"
        ref={ref}
        render={<ul data-host-list="" />}
      >
        <Operations.Item
          className={({ operation: state }) => `host-${state.toLowerCase()}`}
          onClick={() => events.push("click")}
          operation={operation}
          render={<li data-host-item="" />}
        />
      </Operations.Root>,
    );

    const item = document.querySelector("[data-host-item]");
    expect(ref.current?.dataset.hostList).toBe("");
    expect(ref.current?.className).toContain("host-provisioning");
    expect(item?.className).toContain("host-create");
    await userEvent.click(item as HTMLElement);
    expect(events).toEqual(["click"]);
  });
});
