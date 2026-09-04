import { DateTime, Effect, Layer, Redacted } from "effect";

import * as Cleanup from "../../Cleanup.ts";
import * as Connect from "../../Connect.ts";
import * as Custody from "../../Custody.ts";
import * as DnsRecord from "../../DnsRecord.ts";
import * as Errors from "../error.ts";
import * as Reason from "../../Reason.ts";
import * as DomainKit from "../../DomainKit.ts";
import * as Principal from "../../Principal.ts";
import * as Provider from "../../Provider.ts";
import * as Provision from "../../Provision.ts";
import * as Receipt from "../../Receipt.ts";
import * as Resolver from "../../Resolver.ts";
import * as Storage from "../../Storage.ts";
import { fresh } from "../ids.ts";

export const cases = [
  "create-readback-cleanup",
  "exact-noop",
  "conflict",
  "stale-plan",
  "partial-apply-cleanup",
  "rejected-token",
] as const;
export type Case = (typeof cases)[number];

const principal = Principal.make({ ownerId: "conformance", actorId: "conformance" });

const failure = (name: Case, message: string) =>
  new Errors.DomainKitError({
    reason: new Reason.InvalidInput({
      message: `provider conformance ${name}: ${message}`,
      field: "conformance",
    }),
  });

const expect = (name: Case, condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(failure(name, message));

type Env = Storage.Service | Connect.Service | Provision.Service | Cleanup.Service;

/** Attach `zone` to a connection built straight from `credential`, bypassing `authenticate`. */
const attachZone = (
  definition: Provider.Definition,
  credential: Provider.Credential,
  zone: string,
) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const custody = yield* Custody.Service;
    const now = yield* DateTime.now;
    const authorization = new Storage.Authorization({
      id: yield* fresh("auth"),
      ownerId: principal.ownerId,
      provider: definition.id,
      method: "token",
      capabilities: ["dns:read", "dns:write"],
      context: yield* Provider.encodeContext(definition, credential.context),
      revocation: "active",
      createdBy: principal.actorId,
      createdAt: now,
    });
    yield* storage.authorizations.upsert({
      authorization,
      credential: new Storage.Credential({
        ciphertext: yield* custody.seal(credential.secret),
        expiresAt: null,
        rotatedAt: now,
      }),
    });
    const connection = yield* storage.connections.create(authorization.id);
    const attached = yield* Connect.attach({ connectionId: connection.id, domain: zone });
    if (!(attached instanceof Storage.Attachment)) {
      return yield* Effect.fail(
        failure("create-readback-cleanup", `zone ${zone} needs a selection; pass an exact zone`),
      );
    }
    return attached;
  });

const cname = (zone: string, label: string) =>
  DnsRecord.cname({ name: `${label}.${zone}`, target: "target.example.net", ttl: 300 });
const txt = (zone: string, label: string, value: string) =>
  DnsRecord.txt({ name: `${label}.${zone}`, value, ttl: 300 });

const recordIds = (receipt: Receipt.Model) =>
  Receipt.applied(receipt).map(({ providerRecordId }) => providerRecordId);

/**
 * Runs create/readback/cleanup, exact-noop, conflict, stale-plan, partial-apply, and
 * rejected-token against a real provider definition, through the same Provision and Cleanup
 * services hosts use.
 */
export const provider = (
  definition: Provider.Definition,
  credential: Provider.Credential,
  zone: string,
  options: {
    readonly prefix?: string;
    /**
     * Token values the provider rejects, for the `rejected-token` case. Default: every required
     * field set to an empty secret, which needs a token method whose required fields are all
     * secrets.
     */
    readonly rejectedToken?: Provider.TokenValues;
  } = {},
): Effect.Effect<void, Errors.DomainKitError> => {
  const prefix = options.prefix ?? "domainkit-conformance";
  const run = <A>(
    target: Provider.Definition,
    body: (
      dns: Provider.Dns,
      attachment: Storage.Attachment,
    ) => Effect.Effect<A, Errors.DomainKitError, Env | Principal.Service>,
  ) =>
    Effect.gen(function* () {
      const attachment = yield* attachZone(target, credential, zone);
      const { session, target: resolved } = yield* Connect.session(attachment.id);
      return yield* body(session.dns(resolved), attachment);
    }).pipe(
      Effect.provideService(Principal.Service, principal),
      Effect.provide(
        DomainKit.layerMemory({
          providers: [target],
          resolver: Layer.succeed(Resolver.Service)(silentResolver),
        }),
      ),
    );

  const cleanup = (dns: Provider.Dns, ids: () => ReadonlyArray<string>) =>
    Effect.suspend(() =>
      Effect.forEach(ids(), (id) => dns.delete(zone, id).pipe(Effect.ignore), { discard: true }),
    );

  const createReadbackCleanup = run(definition, (dns, attachment) => {
    let created: ReadonlyArray<string> = [];
    const name: Case = "create-readback-cleanup";
    return Effect.gen(function* () {
      const requirements = [
        cname(zone, `${prefix}-create`),
        txt(zone, `${prefix}-page`, "domainkit"),
      ];
      const plan = yield* Provision.plan({ domain: attachment.domain, requirements });
      yield* expect(
        name,
        plan.operations.every(({ _tag }) => _tag === "Create"),
        "expected two Create operations",
      );
      const receipt = yield* Provision.apply(yield* Provision.approve(plan));
      created = recordIds(receipt);
      yield* expect(
        name,
        receipt.status === "complete" && created.length === 2,
        "apply must return a complete receipt with provider record ids",
      );
      const observed = yield* dns.list(zone);
      yield* expect(
        name,
        requirements.every((requirement) =>
          observed.some(({ record }) => DnsRecord.equals(record, requirement)),
        ),
        "list must return every created record, including across provider pages",
      );
      const cleanupPlan = yield* Cleanup.plan({ receiptId: receipt.id });
      yield* expect(
        name,
        cleanupPlan.operations.every(({ _tag }) => _tag === "Delete"),
        "cleanup plan must delete both records",
      );
      const cleaned = yield* Cleanup.apply(yield* Cleanup.approve(cleanupPlan));
      const remaining = yield* Effect.forEach(created, (id) => dns.get(zone, id));
      yield* expect(
        name,
        cleaned.status === "complete" && remaining.every((record) => record === null),
        "receipt-bound cleanup must remove every created record",
      );
      created = [];
    }).pipe(Effect.ensuring(cleanup(dns, () => created)));
  });

  const exactNoop = run(definition, (dns, attachment) => {
    let created: ReadonlyArray<string> = [];
    const name: Case = "exact-noop";
    return Effect.gen(function* () {
      const requirement = cname(zone, `${prefix}-exact`);
      const { providerRecordId } = yield* dns.create(zone, requirement);
      created = [providerRecordId];
      const plan = yield* Provision.plan({
        domain: attachment.domain,
        requirements: [requirement],
      });
      yield* expect(name, plan.operations[0]?._tag === "Noop", "an exact record must plan as Noop");
      const receipt = yield* Provision.apply(yield* Provision.approve(plan));
      yield* expect(
        name,
        Receipt.applied(receipt).length === 0,
        "an exact plan must not create another record",
      );
    }).pipe(Effect.ensuring(cleanup(dns, () => created)));
  });

  const conflict = run(definition, (dns, attachment) => {
    let created: ReadonlyArray<string> = [];
    const name: Case = "conflict";
    return Effect.gen(function* () {
      const { providerRecordId } = yield* dns.create(
        zone,
        txt(zone, `${prefix}-conflict`, "occupied"),
      );
      created = [providerRecordId];
      const plan = yield* Provision.plan({
        domain: attachment.domain,
        requirements: [cname(zone, `${prefix}-conflict`)],
      });
      yield* expect(
        name,
        plan.operations[0]?._tag === "Conflict",
        "a CNAME over an occupied name must plan as Conflict",
      );
      const rejected = yield* Provision.approve(plan).pipe(Effect.result);
      yield* expect(
        name,
        rejected._tag === "Failure" && rejected.failure.reason._tag === "Conflict",
        "approve must fail closed on conflicts",
      );
    }).pipe(Effect.ensuring(cleanup(dns, () => created)));
  });

  const stalePlan = run(definition, (dns, attachment) => {
    let created: ReadonlyArray<string> = [];
    const name: Case = "stale-plan";
    return Effect.gen(function* () {
      const requirement = cname(zone, `${prefix}-stale`);
      const plan = yield* Provision.plan({
        domain: attachment.domain,
        requirements: [requirement],
      });
      const approval = yield* Provision.approve(plan);
      const { providerRecordId } = yield* dns.create(zone, requirement);
      created = [providerRecordId];
      const stale = yield* Provision.apply(approval).pipe(Effect.result);
      yield* expect(
        name,
        stale._tag === "Failure" && stale.failure.reason._tag === "Stale",
        "apply must reject provider state that changed after approval",
      );
    }).pipe(Effect.ensuring(cleanup(dns, () => created)));
  });

  const flaky: Provider.Definition = {
    ...definition,
    session: (input) => {
      const session = definition.session(input);
      return {
        ...session,
        dns: (target) => {
          const dns = session.dns(target);
          let writes = 0;
          return {
            ...dns,
            create: (targetZone, record) => {
              writes += 1;
              return writes === 2
                ? Errors.fail(
                    new Reason.ProviderUnavailable({
                      provider: definition.id,
                      message: "injected conformance failure",
                    }),
                  )
                : dns.create(targetZone, record);
            },
          };
        },
      };
    },
  };

  const partialApplyCleanup = run(flaky, (dns, attachment) => {
    let created: ReadonlyArray<string> = [];
    const name: Case = "partial-apply-cleanup";
    return Effect.gen(function* () {
      const plan = yield* Provision.plan({
        domain: attachment.domain,
        requirements: [
          cname(zone, `${prefix}-partial-one`),
          txt(zone, `${prefix}-partial-two`, "domainkit"),
        ],
      });
      const receipt = yield* Provision.apply(yield* Provision.approve(plan));
      created = recordIds(receipt);
      yield* expect(
        name,
        receipt.status === "partial" && created.length === 1,
        "a later write failure must preserve the first confirmed write in a partial receipt",
      );
      const cleanupPlan = yield* Cleanup.plan({ receiptId: receipt.id });
      yield* Cleanup.apply(yield* Cleanup.approve(cleanupPlan));
      const remaining = yield* Effect.forEach(created, (id) => dns.get(zone, id));
      yield* expect(
        name,
        remaining.every((record) => record === null),
        "partial receipt cleanup must remove the confirmed write",
      );
      created = [];
    }).pipe(Effect.ensuring(cleanup(dns, () => created)));
  });

  /** A token the provider rejects must read as `Unauthenticated`, so a host tells the customer the provider refused it. */
  const rejectedToken = Effect.gen(function* () {
    const name: Case = "rejected-token";
    const auth = definition.auth.token;
    if (auth === undefined) return;
    const required = Provider.tokenFields(auth).filter((field) => field.required);
    if (options.rejectedToken === undefined && required.some((field) => !field.secret)) {
      return yield* Effect.fail(
        failure(
          name,
          `the token method requires ${required
            .filter((field) => !field.secret)
            .map((field) => field.name)
            .join(", ")}; pass options.rejectedToken with values the provider rejects`,
        ),
      );
    }
    const values =
      options.rejectedToken ??
      Object.fromEntries(required.map((field) => [field.name, Redacted.make("")]));
    const outcome = yield* auth.authenticate(values).pipe(Effect.result);
    yield* expect(
      name,
      outcome._tag === "Failure" && outcome.failure.reason._tag === "Unauthenticated",
      "authenticating a rejected token must fail Unauthenticated",
    );
  });

  return Effect.all(
    [createReadbackCleanup, exactNoop, conflict, stalePlan, partialApplyCleanup, rejectedToken],
    { discard: true },
  );
};

/** Verification is out of scope for the provider contract; keep the pool quiet. */
const silentResolver: Resolver.Interface = {
  resolve: () => Effect.succeed([]),
};
