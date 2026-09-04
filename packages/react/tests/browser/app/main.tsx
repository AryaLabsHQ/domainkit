/**
 * The browser fixture: `Domain.Flow` over the same fake transport the unit tests use, so the
 * Playwright run exercises the real stylesheet, portals, and focus behaviour with no host app.
 */
import { DnsRecord, Plan, Verify } from "domainkit";
import { Transport } from "domainkit/client";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { Connect, Domain, DomainKit, Testing, Verify as VerifyUi } from "../../../src/index.ts";
// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
import "../../../src/styles.css";

const parameters = new URLSearchParams(window.location.search);
const zone = parameters.get("zone") ?? "example.com";
const domain = `app.${zone}`;
const colorScheme = parameters.get("scheme") === "dark" ? "dark" : "light";

const transport = Testing.transport({ provider: { oauth: true, zones: [zone] } });

/**
 * The interactive method's `returnTo` rides on the request, not on the authorization URL, so the
 * fixture reports the request rather than following the redirect.
 */
function ReturnToProbe() {
  const [started, setStarted] = useState<string>("");
  const recording = useMemo(() => {
    const connection = transport.connection;
    if (connection === undefined) throw new Error("The fixture transport has no connection group");
    return {
      ...transport,
      connection: {
        ...connection,
        start: (input: Parameters<typeof connection.start>[0]) => {
          setStarted(JSON.stringify(input.method));
          return connection.start(input);
        },
      },
    };
  }, []);
  return (
    <DomainKit.Root navigate={() => {}} transport={recording}>
      <Connect.Flow domain={domain} />
      <pre data-testid="started">{started}</pre>
    </DomainKit.Root>
  );
}

const requirements = [
  DnsRecord.cname({ name: domain, purpose: "Serve your site", target: "edge.example.com" }),
  DnsRecord.txt({
    name: `_acme.${domain}`,
    purpose: "Prove ownership",
    value: "acme-verify=7f3a",
  }),
];

/** A readiness the fake transport cannot reach on its own: a requirement observed as mismatched. */
const observedAt = DateTime.makeUnsafe("2026-09-04T10:00:00.000Z");
const mismatched: Transport.Readiness = {
  attachmentId: "attachment-1",
  checkedAt: observedAt,
  domain,
  host: [],
  nextCheckAt: null,
  overall: "pending",
  requirements: [
    {
      evidence: [
        new Verify.ProviderEvidence({
          detail: null,
          observedAt,
          provider: "fake",
          status: "mismatch",
          values: ["old.example.com"],
        }),
        new Verify.PublicDnsEvidence({
          detail: "The name resolves somewhere else.",
          observedAt,
          resolver: "cloudflare",
          status: "mismatch",
          values: ["old.example.com", "older.example.com"],
        }),
        new Verify.PublicDnsEvidence({
          detail: null,
          observedAt,
          resolver: "google",
          status: "missing",
          values: [],
        }),
        new Verify.PublicDnsEvidence({
          detail: "The resolver did not answer.",
          observedAt,
          resolver: "quad9",
          status: "unknown",
          values: [],
        }),
      ],
      operationId: Plan.OperationId.make("op-1"),
      record: requirements[0] as DnsRecord.Model,
      status: "mismatch",
    },
  ],
};

const container = document.querySelector("#root");
if (container === null) throw new Error("The fixture has no #root");

const view = parameters.get("view");

/**
 * The browser's own `fetch`, untouched: `Transport.fromFetch` with no `fetch` option against a
 * route the Playwright spec answers. A method-bound call throws "Illegal invocation" in Chrome.
 */
function FetchProbe() {
  const [result, setResult] = useState("pending");
  useEffect(() => {
    const connection = Transport.fromFetch("/api/domainkit").connection;
    if (connection === undefined) return setResult("no connection group");
    Effect.runPromise(connection.inspect(domain)).then(
      (snapshot) => setResult(JSON.stringify({ status: snapshot.status, domain: snapshot.domain })),
      (error: unknown) => setResult(`error: ${String(error)}`),
    );
  }, []);
  return <pre data-testid="fetch-probe">{result}</pre>;
}

/**
 * The flag flips in place rather than on reload: the fake transport keeps its state in memory, so
 * a reload would forget the connection this view is meant to show.
 */
function FlowWithReadOnlyToggle() {
  const [readOnly, setReadOnly] = useState(false);
  return (
    <>
      <button data-testid="toggle-readonly" onClick={() => setReadOnly(!readOnly)} type="button">
        Toggle read-only
      </button>
      <Domain.Flow
        className="host-flow"
        domain={domain}
        readOnly={readOnly}
        requirements={requirements}
      />
    </>
  );
}

createRoot(container).render(
  <StrictMode>
    {view === "returnto" ? (
      <ReturnToProbe />
    ) : view === "fetch" ? (
      <FetchProbe />
    ) : (
      <DomainKit.Root colorScheme={colorScheme} theme={{ accent: "#4f46e5" }} transport={transport}>
        {view === "evidence" ? (
          <VerifyUi.Evidence readiness={mismatched} />
        ) : (
          <FlowWithReadOnlyToggle />
        )}
      </DomainKit.Root>
    )}
  </StrictMode>,
);
