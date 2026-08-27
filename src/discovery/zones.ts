import { getDomain } from "tldts";

import type { DomainName } from "../domain/domain-name.ts";
import { parseDomainName } from "../domain/domain-name.ts";
import { InvalidInputError } from "../errors.ts";

export function deriveZoneCandidates(input: string): ReadonlyArray<DomainName> {
  const domain = parseDomainName(input);
  const registrable = getDomain(domain, { allowPrivateDomains: true });
  if (registrable === null) {
    throw new InvalidInputError({ message: "Domain does not have a registrable DNS zone" });
  }
  const labels = domain.split(".");
  const registrableLabels = registrable.split(".").length;
  const candidates: Array<DomainName> = [];
  for (let index = 0; index <= labels.length - registrableLabels; index += 1) {
    candidates.push(parseDomainName(labels.slice(index).join(".")));
  }
  return candidates;
}
