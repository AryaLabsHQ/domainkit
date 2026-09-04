/**
 * The browser fixture: `Domain.Flow` over the same fake transport the unit tests use, so the
 * Playwright run exercises the real stylesheet, portals, and focus behaviour with no host app.
 */
import { DnsRecord, DomainKit as Kit, Plan, Reason, Verify } from "domainkit";
import { Server } from "domainkit/server";
import { Testing as CoreTesting } from "domainkit/testing";
import { Transport } from "domainkit/client";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  Connect,
  Domain,
  DomainKit,
  Outcome,
  Provision,
  Testing,
  Verify as VerifyUi,
} from "../../../src/index.ts";
// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet has nothing to bind
import "../../../src/styles.css";

const parameters = new URLSearchParams(window.location.search);
// Every page load builds its own in-memory server, so one zone serves every view. The names here
// are what the PR's screenshots show a reviewer, so they read the way a customer's screen reads.
const zone = parameters.get("zone") ?? "northwind.dev";
const domain = `mail.${zone}`;
const colorScheme = parameters.get("scheme") === "dark" ? "dark" : "light";

/** Square artwork a host passes in, the way `marks` is meant to be used. */
const marks = {
  beacon: (
    <svg aria-hidden="true" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#0f766e" height="32" width="32" />
      <path d="M16 8 22 24H10Z" fill="#ecfdf5" />
      <path d="M11 19h10" stroke="#0f766e" strokeWidth="2" />
      <circle cx="16" cy="8" fill="#5eead4" r="2.6" />
    </svg>
  ),
  meridian: (
    <svg aria-hidden="true" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <rect fill="#312e81" height="32" width="32" />
      <g fill="none" stroke="#c7d2fe" strokeWidth="1.8">
        <circle cx="16" cy="16" r="8.5" />
        <ellipse cx="16" cy="16" rx="3.6" ry="8.5" />
        <path d="M7.5 16h17" />
      </g>
    </svg>
  ),
};

// `host=none` drops the nameserver suffixes, so discovery finds no provider for the zone.
const hosted = parameters.get("host") !== "none";
const transport = Testing.transport({
  provider: {
    id: "meridian",
    name: "Meridian DNS",
    ...(hosted ? { nameserverSuffixes: [zone] } : {}),
    oauth: true,
    zones: [zone],
  },
  // Public DNS is read through a real resolver, and the observer's name reaches the evidence list.
  resolver: { id: "cloudflare" },
});

/**
 * Two registered providers, which `Testing.transport` cannot build: the dialog only narrows, and
 * only offers "use a different provider", when there is another one to offer.
 */
const twoProviders = (): Transport.Interface => {
  const serves = CoreTesting.provider({
    id: "meridian",
    name: "Meridian DNS",
    ...(hosted ? { nameserverSuffixes: [zone] } : {}),
    oauth: true,
    zones: [zone],
  });
  const other = CoreTesting.provider({ id: "beacon", name: "Beacon Host", zones: [] });
  const { handler } = Server.toWebHandler(
    Kit.layerMemory({
      providers: [serves, other],
      resolver: CoreTesting.resolver(undefined, { id: "cloudflare" }),
    }).pipe(
      Layer.merge(
        Layer.succeed(Server.Identity)({
          principal: () => Effect.succeed(CoreTesting.principal),
        }),
      ),
    ),
  );
  const live = Transport.fromFetch("http://domainkit.test", {
    fetch: (input, init) => handler(new Request(input, init)),
  });
  const connection = live.connection;
  if (connection === undefined) throw new Error("The fixture transport has no connection group");
  // Cloudflare declares an optional account id beside its token; the fake declares one field, so
  // the descriptor gains it here rather than in the provider, which is where the wire carries it.
  return {
    ...live,
    connection: {
      ...connection,
      inspect: (target: string) =>
        Effect.map(connection.inspect(target), (snapshot) => ({
          ...snapshot,
          providers: snapshot.providers.map((provider) => ({
            ...provider,
            methods: provider.methods.map((method) =>
              method.fields === null
                ? method
                : {
                    ...method,
                    docsUrl: "https://meridiandns.example/docs/api-tokens",
                    fields: [
                      ...method.fields,
                      { name: "accountId", required: false, secret: false },
                    ],
                  },
            ),
          })),
        })),
    },
  };
};

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
    <DomainKit.Root marks={marks} navigate={() => {}} transport={recording}>
      <Connect.Flow domain={domain} />
      <pre data-testid="started">{started}</pre>
    </DomainKit.Root>
  );
}

/** What a mail product actually asks a customer to add before it will send for their domain. */
const requirements = [
  DnsRecord.cname({
    name: `track.${domain}`,
    purpose: "Track link clicks",
    target: "links.sendgate.app",
  }),
  DnsRecord.mx({
    exchange: "mx1.sendgate.app",
    name: domain,
    priority: 10,
    purpose: "Deliver inbound mail",
  }),
  DnsRecord.txt({
    name: `sendgate._domainkey.${domain}`,
    purpose: "Sign outgoing mail",
    value: "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7Vd8Kx2mQ1nJ9pQxUeH",
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
          provider: "meridian",
          status: "mismatch",
          values: ["links.legacy-sendgate.app"],
        }),
        new Verify.PublicDnsEvidence({
          detail: "The name resolves somewhere else.",
          observedAt,
          resolver: "cloudflare",
          status: "mismatch",
          values: ["links.legacy-sendgate.app", "links.old-sendgate.app"],
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

/**
 * A provider that turns down every token, the way a real one answers one it does not accept. The
 * fake provider only refuses an empty token, and a required field never submits empty.
 */
const refusesTokens = () => {
  const connection = transport.connection;
  if (connection === undefined) throw new Error("The fixture transport has no connection group");
  return {
    ...transport,
    connection: {
      ...connection,
      // Two secrets, so a rejection that names no field answers once rather than under each.
      inspect: (target: string) =>
        Effect.map(connection.inspect(target), (snapshot) => ({
          ...snapshot,
          providers: snapshot.providers.map((provider) => ({
            ...provider,
            methods: provider.methods.map((method) =>
              method.fields === null
                ? method
                : {
                    ...method,
                    fields: [
                      ...method.fields,
                      { name: "signingKey", required: true, secret: true },
                    ],
                  },
            ),
          })),
        })),
      start: (input: Parameters<typeof connection.start>[0]) =>
        input.method._tag === "Token"
          ? Effect.fail(
              new Kit.Error({
                reason: new Reason.Unauthenticated({ message: "the token was refused" }),
              }),
            )
          : connection.start(input),
    },
  };
};

/**
 * A connect that cannot be written down, so the outcome carries a title and the line under it:
 * the anatomy the three shapes below are here to show.
 */
const storageDown = (): Transport.Interface => {
  const connection = transport.connection;
  if (connection === undefined) throw new Error("The fixture transport has no connection group");
  return {
    ...transport,
    connection: {
      ...connection,
      start: () =>
        Effect.fail(
          new Kit.Error({
            reason: new Reason.StorageFailed({
              message: "the write did not land",
              operation: "connections.put",
            }),
          }),
        ),
    },
  };
};

/**
 * The outcome in the three shapes a host meets it: the default card, the inline row, and a
 * composition of the host's own where only the words come from the catalog.
 */
function Outcomes() {
  const controller = Connect.useController({ domain });
  const connect = controller.connect;
  // The failure comes off the real lifecycle rather than a state the view sets by hand.
  useEffect(() => {
    connect({ method: "token", provider: "meridian", values: { token: "tok" } });
  }, [connect]);
  return (
    <div data-testid="outcomes">
      <div data-testid="outcome-card">
        <Connect.Outcome controller={controller} />
      </div>
      <div data-testid="outcome-inline">
        <Connect.Outcome controller={controller} layout="inline" />
      </div>
      <div data-testid="outcome-host">
        <Connect.Outcome controller={controller} layout="inline">
          <Outcome.Media variant="default">
            <span data-testid="host-media">!</span>
          </Outcome.Media>
          <Outcome.Title />
          <Outcome.Description />
          <Outcome.Content />
        </Connect.Outcome>
      </div>
    </div>
  );
}

/**
 * One transport verb that never answers, so a dialog can be caught with a command in flight. The
 * fake transport is in-process, so there is no request to delay from the test side.
 */
function Hanging({ verb }: { readonly verb: string }) {
  const held = useMemo(() => {
    const connection = transport.connection;
    const provisioning = transport.provisioning;
    if (connection === undefined || provisioning === undefined) {
      throw new Error("The fixture transport is missing a group");
    }
    return {
      ...transport,
      connection: {
        ...connection,
        ...(verb === "start" ? { start: () => Effect.never } : {}),
        ...(verb === "disconnect" ? { disconnect: () => Effect.never } : {}),
      },
      provisioning: {
        ...provisioning,
        ...(verb === "plan" ? { plan: () => Effect.never } : {}),
      },
    };
  }, [verb]);
  return (
    <DomainKit.Root marks={marks} navigate={() => {}} transport={held}>
      <Domain.Flow domain={domain} requirements={requirements} />
    </DomainKit.Root>
  );
}

const container = document.querySelector("#root");
if (container === null) throw new Error("The fixture has no #root");

const view = parameters.get("view");

/** Built once: a new server is a new world, and the dialog must survive a re-render. */
const providers = view === "providers" ? twoProviders() : transport;

/** Built once too: a new transport on every render would restart the connect the view runs. */
const down = view === "outcome" ? storageDown() : transport;

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
        connect={parameters.get("connect") === "always" ? "always" : "detected"}
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
    ) : view === "hang" ? (
      <Hanging verb={parameters.get("hang") ?? "start"} />
    ) : view === "fetch" ? (
      <FetchProbe />
    ) : (
      <DomainKit.Root
        colorScheme={colorScheme}
        marks={marks}
        theme={{ accent: "#4f46e5" }}
        transport={
          view === "reject"
            ? refusesTokens()
            : view === "providers"
              ? providers
              : view === "outcome"
                ? down
                : transport
        }
      >
        {view === "providers" ? (
          <Connect.Flow
            connect={parameters.get("connect") === "always" ? "always" : "detected"}
            domain={domain}
          />
        ) : view === "reject" ? (
          <Connect.Flow domain={domain} />
        ) : view === "review" ? (
          // `Provision.Flow` is the review dialog on its own; `Domain.Flow` reviews inline.
          <>
            <Connect.Flow domain={domain} />
            <Provision.Flow domain={domain} requirements={requirements} />
          </>
        ) : view === "outcome" ? (
          <Outcomes />
        ) : view === "evidence" ? (
          <VerifyUi.Evidence readiness={mismatched} />
        ) : (
          <FlowWithReadOnlyToggle />
        )}
      </DomainKit.Root>
    )}
  </StrictMode>,
);
