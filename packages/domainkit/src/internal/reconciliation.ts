import * as DnsRecord from "../DnsRecord.ts";
import type * as Plan from "../Plan.ts";
import { isSpf } from "./spf.ts";

interface Collision {
  readonly reason: Plan.Conflict["reason"];
  readonly existing: ReadonlyArray<DnsRecord.Observed>;
}

/** Safety constraints precede exact matches in both planning and observation. */
export const collision = (
  record: DnsRecord.Model,
  observed: ReadonlyArray<DnsRecord.Observed>,
): Collision | undefined => {
  const sameName = observed.filter((candidate) => candidate.name === record.name);
  const cnameCollisions = sameName.filter(
    (candidate) =>
      (record._tag === "CNAME" ||
        candidate._tag === "CNAME" ||
        (candidate._tag === "Opaque" && candidate.type === "CNAME")) &&
      !DnsRecord.equals(candidate, record),
  );
  if (cnameCollisions.length > 0) return { reason: "cname-collision", existing: cnameCollisions };
  const sameSet = sameName.filter((candidate) => DnsRecord.sameSet(candidate, record));
  if (sameSet.some((candidate) => candidate._tag === "Opaque"))
    return { reason: "opaque", existing: sameSet };
  if (record._tag === "TXT" && record.constraint === "spf") {
    const spf = sameSet.filter((candidate) => candidate._tag === "TXT" && isSpf(candidate.value));
    if (spf.length > 1 || spf.some((candidate) => !DnsRecord.equals(candidate, record)))
      return { reason: "spf-conflict", existing: spf };
  }
  const incompatible = sameSet.filter((candidate) => !DnsRecord.equals(candidate, record));
  if (record.policy === "exclusive" && incompatible.length > 0)
    return { reason: "exclusive-name", existing: incompatible };
  return undefined;
};

/** Both sides' constraints apply, regardless of requirement order or canonical sorting. */
export const projectedCollision = (
  record: DnsRecord.Model,
  requirements: ReadonlyArray<DnsRecord.Model>,
): Collision | undefined => {
  for (const other of requirements) {
    if (DnsRecord.equals(record, other)) continue;
    const forward = collision(record, [other]);
    if (forward !== undefined) return forward;
    const reverse = collision(other, [record]);
    if (reverse !== undefined) return { reason: reverse.reason, existing: [other] };
  }
  return undefined;
};
