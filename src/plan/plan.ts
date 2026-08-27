import { Schema } from "effect";

import { parseDomainName } from "../domain/domain-name.ts";
import type { DnsRecord, DnsRecordInput } from "../domain/dns-record.ts";
import { parseDnsRecord, sameRecordData } from "../domain/dns-record.ts";
import { AuthorizationError, PlanConflictError, ProviderError } from "../errors.ts";
import type { DnsProvider } from "../provider/provider.ts";
import { canonicalJson, sha256 } from "./canonical-json.ts";
import { ApplyReceipt, type DnsPlan, type PlanAuthorization, type PlanOperation } from "./types.ts";

export interface CreatePlanInput {
  readonly provider: DnsProvider;
  readonly requirements: ReadonlyArray<DnsRecord | DnsRecordInput>;
  readonly zone: string;
}

export async function createPlan(input: CreatePlanInput): Promise<DnsPlan> {
  const zone = parseDomainName(input.zone);
  const requirements = input.requirements.map(parseDnsRecord).sort(compareRecords);
  let existing: ReadonlyArray<DnsRecord>;
  try {
    existing = (await input.provider.listRecords(zone)).map(parseDnsRecord).sort(compareRecords);
  } catch (cause) {
    throw new ProviderError({ message: messageOf(cause), providerId: input.provider.id });
  }

  const operations = await Promise.all(
    requirements.map((requirement) => reconcileRequirement(requirement, existing)),
  );
  const unsigned = {
    operations,
    providerId: input.provider.id,
    version: "domainkit.dns-plan.v1" as const,
    zone,
  };
  return { ...unsigned, digest: await sha256(unsigned) };
}

export async function authorizePlan(
  plan: DnsPlan,
  operationIds?: ReadonlyArray<string>,
  options: { readonly allowPartial?: boolean } = {},
): Promise<PlanAuthorization> {
  await validatePlanDigest(plan);
  const createIds = plan.operations
    .filter((operation) => operation._tag === "create")
    .map(({ id }) => id);
  const selected = [...new Set(operationIds ?? createIds)].sort();
  const unknown = selected.filter((id) => !createIds.includes(id));
  if (unknown.length > 0) {
    throw new AuthorizationError({ message: `Unknown operation IDs: ${unknown.join(", ")}` });
  }
  if (!options.allowPartial && selected.length !== createIds.length) {
    throw new AuthorizationError({ message: "Partial authorization requires allowPartial" });
  }
  return {
    allowPartial: options.allowPartial ?? false,
    operationIds: selected,
    planDigest: plan.digest,
    version: "domainkit.plan-authorization.v1",
  };
}

export async function applyPlan(input: {
  readonly authorization: PlanAuthorization;
  readonly now?: () => Date;
  readonly plan: DnsPlan;
  readonly provider: DnsProvider;
}): Promise<typeof ApplyReceipt.Type> {
  const { authorization, plan, provider } = input;
  await validatePlanDigest(plan);
  if (authorization.planDigest !== plan.digest) {
    throw new AuthorizationError({ message: "Authorization belongs to a different plan" });
  }
  if (provider.id !== plan.providerId) {
    throw new AuthorizationError({ message: "Provider does not match the approved plan" });
  }
  const conflicts = plan.operations.filter((operation) => operation._tag === "conflict");
  if (conflicts.length > 0) {
    throw new PlanConflictError({ operationIds: conflicts.map(({ id }) => id) });
  }

  const creates = plan.operations.filter(
    (operation): operation is Extract<PlanOperation, { readonly _tag: "create" }> =>
      operation._tag === "create",
  );
  const approved = new Set(authorization.operationIds);
  const unknown = authorization.operationIds.filter(
    (id) => !creates.some((operation) => operation.id === id),
  );
  if (unknown.length > 0) {
    throw new AuthorizationError({
      message: `Authorization contains unknown operations: ${unknown.join(", ")}`,
    });
  }
  if (!authorization.allowPartial && creates.some(({ id }) => !approved.has(id))) {
    throw new AuthorizationError({
      message: "Authorization does not cover every create operation",
    });
  }

  const operations = [];
  for (const operation of creates) {
    if (!approved.has(operation.id)) continue;
    try {
      const result = await provider.createRecord(plan.zone, operation.requirement);
      operations.push({ operationId: operation.id, providerRecordId: result.providerRecordId });
    } catch (cause) {
      throw new ProviderError({ message: messageOf(cause), providerId: provider.id });
    }
  }

  return Schema.decodeUnknownSync(ApplyReceipt)({
    appliedAt: (input.now ?? (() => new Date()))().toISOString(),
    operations,
    planDigest: plan.digest,
    providerId: plan.providerId,
    version: "domainkit.apply-receipt.v1",
    zone: plan.zone,
  });
}

export function renderManualInstructions(plan: DnsPlan): ReadonlyArray<string> {
  return plan.operations.map((operation) => {
    const record = operation.requirement;
    const data = Object.entries(record)
      .filter(([key]) => !["_tag", "metadata", "name", "policy", "ttl"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return `${operation._tag.toUpperCase()} ${record._tag} ${record.name} ${data}`.trim();
  });
}

async function reconcileRequirement(
  requirement: DnsRecord,
  allExisting: ReadonlyArray<DnsRecord>,
): Promise<PlanOperation> {
  const sameName = allExisting.filter((record) => record.name === requirement.name);
  const sameSet = sameName.filter((record) => record._tag === requirement._tag);
  const exact = sameSet.find((record) => sameRecordData(record, requirement));
  const id = await sha256({ requirement });

  if (exact !== undefined) {
    return { _tag: "noop", id, requirement, ttlDrift: exact.ttl !== requirement.ttl };
  }

  const cnameConflict =
    sameName.length > 0 &&
    (requirement._tag === "CNAME" || sameName.some((record) => record._tag === "CNAME"));
  if (cnameConflict) {
    return {
      _tag: "conflict",
      existing: sameName,
      id,
      reason: "CNAME records cannot coexist with other records at the same name",
      requirement,
    };
  }
  if (sameSet.length > 0 && requirement.policy === "exclusive") {
    return {
      _tag: "conflict",
      existing: sameSet,
      id,
      reason: "The exclusive record set already contains incompatible data",
      requirement,
    };
  }
  return { _tag: "create", id, requirement };
}

async function validatePlanDigest(plan: DnsPlan): Promise<void> {
  const { digest: _digest, ...unsigned } = plan;
  if ((await sha256(unsigned)) !== plan.digest) {
    throw new AuthorizationError({ message: "Plan digest does not match its contents" });
  }
}

function compareRecords(left: DnsRecord, right: DnsRecord): number {
  return canonicalJson(left).localeCompare(canonicalJson(right));
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
