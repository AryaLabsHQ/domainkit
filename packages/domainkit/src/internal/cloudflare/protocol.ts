import { Schema as S } from "effect";

export const ErrorDetail = S.Struct({ code: S.Number, message: S.String });

const Message = S.Struct({ code: S.optionalKey(S.Number), message: S.String });

export const ResultInfo = S.Struct({
  count: S.optionalKey(S.Number),
  page: S.optionalKey(S.Number),
  per_page: S.optionalKey(S.Number),
  total_count: S.optionalKey(S.Number),
  total_pages: S.optionalKey(S.Number),
});

export const BaseEnvelope = S.Struct({
  errors: S.Array(ErrorDetail),
  messages: S.optionalKey(S.Array(Message)),
  success: S.Boolean,
});

export const Account = S.Struct({ id: S.String, name: S.String });
export type Account = typeof Account.Type;

export const Zone = S.Struct({
  account: Account,
  id: S.String,
  name: S.String,
  name_servers: S.optionalKey(S.Array(S.String)),
  status: S.optionalKey(S.String),
  type: S.optionalKey(S.String),
});
export type Zone = typeof Zone.Type;

export const Record = S.Struct({
  content: S.optionalKey(S.String),
  data: S.optionalKey(S.Unknown),
  id: S.String,
  name: S.String,
  priority: S.optionalKey(S.Number),
  proxied: S.optionalKey(S.Boolean),
  ttl: S.Number,
  type: S.String,
});
export type Record = typeof Record.Type;

export const Token = S.Struct({
  expires_on: S.optionalKey(S.NullOr(S.String)),
  id: S.String,
  status: S.String,
});

export const Envelope = S.Struct({
  errors: S.Array(ErrorDetail),
  result: S.Unknown,
  result_info: S.optionalKey(ResultInfo),
  success: S.Boolean,
});
