import { getDomain } from "tldts";

import * as DomainName from "../domain/domain-name.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";

export function candidates(input: string): ReadonlyArray<DomainName.DomainName> {
  const domain = DomainName.parse(input);
  const registrable = getDomain(domain, { allowPrivateDomains: true });
  if (registrable === null) {
    throw new InvalidInputError({ message: "Domain does not have a registrable DNS zone" });
  }
  const labels = domain.split(".");
  const registrableLabels = registrable.split(".").length;
  const values: Array<DomainName.DomainName> = [];
  for (let index = 0; index <= labels.length - registrableLabels; index += 1) {
    values.push(DomainName.parse(labels.slice(index).join(".")));
  }
  return values;
}
