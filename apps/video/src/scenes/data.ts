/** The example records the film and stills share, so the plan, approval, and verification agree. */
export interface RecordSpec {
  readonly type: "TXT" | "CNAME";
  readonly name: string;
  readonly value: string;
}

export const spf: RecordSpec = {
  type: "TXT",
  name: "example.com",
  value: "v=spf1 include:_spf.yourapp.com ~all",
};
export const track: RecordSpec = {
  type: "CNAME",
  name: "track.example.com",
  value: "track.yourapp.com",
};
export const mail: RecordSpec = {
  type: "CNAME",
  name: "mail.example.com",
  value: "mail.yourapp.com",
};

export const records: ReadonlyArray<RecordSpec> = [spf, track, mail];

/** Plan one is blocked; plan two is what the customer reviews after fixing the conflict. */
/** Digests are shown abbreviated (first and last eight hex characters) with an ellipsis, never as a full hash. */
export const blockedDigest = { head: "4d1a82c6", tail: "b7e03f95" };
export const approvedDigest = { head: "9c3f7a21", tail: "e5b8d04e" };

/** The conflict the registry's own catalog words for a CNAME that shares a name. */
export const conflictReason = "A CNAME cannot share a name with other records.";
export const conflictAdvice =
  "Remove the other records on that name at your provider, then check again.";
