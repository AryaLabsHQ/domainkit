import { act } from "@testing-library/react";
import { DnsRecord, Verify as CoreVerify } from "domainkit";
import * as DateTime from "effect/DateTime";

import { Verify } from "../src/index.ts";
import { attach, mount, scenario, until } from "./harness.tsx";

describe("Verify.useController", () => {
  it("observes on mount and reports readiness per requirement", async () => {
    const { domain, requirements, transport } = scenario();
    await attach(transport, domain);
    const view = mount(transport, () =>
      Verify.useController({ domain, polling: false, requirements }),
    );
    await until(() => expect(view.result.current.readiness).not.toBeNull());
    expect(view.result.current.readiness?.requirements).toHaveLength(requirements.length);
    expect(view.result.current.state._tag).toBe("Observed");
  });

  it("drops readiness when the domain changes", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) =>
        Verify.useController({ domain: target, polling: false, requirements }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.readiness).not.toBeNull());
    act(() => view.rerender({ target: sibling }));
    expect(view.result.current.readiness).toBeNull();
  });

  it("refuses an answer that arrives after the controller moved to another domain", async () => {
    const { domain, requirements, sibling, transport } = scenario();
    await attach(transport, domain);
    const view = mount(
      transport,
      ({ target }: { readonly target: string }) =>
        Verify.useController({ domain: target, polling: false, requirements }),
      { initialProps: { target: domain } },
    );
    await until(() => expect(view.result.current.readiness?.domain).toBe(domain));
    act(() => view.rerender({ target: sibling }));
    // The first frame is free of the previous domain's evidence, and the answer still in flight
    // for it never puts that evidence back.
    expect(view.result.current.readiness).toBeNull();
    await until(() => expect(view.result.current.state._tag).toBe("Observed"));
    expect(view.result.current.readiness?.domain).toBe(sibling);
  });

  it("observes again when a requirement changes in a way only the wire sees", async () => {
    const { domain, transport } = scenario();
    const base = DnsRecord.cname({
      name: domain,
      purpose: "Serve your site",
      target: "edge.example.com",
    });
    const retimed = DnsRecord.cname({
      name: domain,
      purpose: "Serve your site",
      target: "edge.example.com",
      ttl: 300,
    });
    const observations = () =>
      transport.calls.filter((call) => call.method === "verification.observe").length;
    const view = mount(
      transport,
      ({ record }: { readonly record: DnsRecord.Model }) =>
        Verify.useController({ domain, polling: false, requirements: [record] }),
      { initialProps: { record: base } },
    );
    await until(() => expect(observations()).toBe(1));
    act(() => view.rerender({ record: retimed }));
    await until(() => expect(observations()).toBe(2));
  });
});

describe("Verify.valuesOf", () => {
  const observedAt = DateTime.makeUnsafe("2026-09-04T10:00:00.000Z");

  it("reports what an observer read back, and nothing for a lookup that never answered", () => {
    const mismatch = new CoreVerify.PublicDnsEvidence({
      detail: null,
      observedAt,
      resolver: "cloudflare",
      status: "mismatch",
      values: ["old.example.com"],
    });
    expect(Verify.valuesOf(mismatch)).toEqual(["old.example.com"]);

    const unanswered = new CoreVerify.PublicDnsEvidence({
      detail: "The resolver did not answer.",
      observedAt,
      resolver: "quad9",
      status: "unknown",
      values: [],
    });
    // An unknown observation is a lookup that never answered, not a name that holds nothing.
    expect(Verify.valuesOf(unanswered)).toBeNull();

    const host = new CoreVerify.HostEvidence({
      detail: null,
      label: "Email identity",
      observedAt,
      source: "ses",
      status: "pending",
    });
    // Host evidence reports a status the host reached rather than values read off a name.
    expect(Verify.valuesOf(host)).toBeNull();
  });
});
