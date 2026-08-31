import { Schema as S } from "effect";

export const ErrorDetail = S.Struct({
  code: S.Number,
  message: S.String,
});
export interface ErrorDetail extends S.Schema.Type<typeof ErrorDetail> {}

export const ResultInfo = S.Struct({
  count: S.optionalKey(S.Number),
  page: S.optionalKey(S.Number),
  per_page: S.optionalKey(S.Number),
  total_count: S.optionalKey(S.Number),
  total_pages: S.optionalKey(S.Number),
});

const Message = S.Struct({
  code: S.optionalKey(S.Number),
  message: S.String,
});

export const BaseEnvelope = S.Struct({
  errors: S.Array(ErrorDetail),
  messages: S.Array(Message),
  success: S.Boolean,
});

export const Account = S.Struct({
  id: S.String,
  name: S.String,
});
export interface Account extends S.Schema.Type<typeof Account> {}

export const Zone = S.Struct({
  account: Account,
  id: S.String,
  name: S.String,
  name_servers: S.Array(S.String),
  status: S.optionalKey(S.String),
  type: S.optionalKey(S.Literals(["full", "partial", "secondary", "internal"])),
});
export interface Zone extends S.Schema.Type<typeof Zone> {}

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
export interface Record extends S.Schema.Type<typeof Record> {}

export const Token = S.Struct({
  expires_on: S.optionalKey(S.String),
  id: S.String,
  not_before: S.optionalKey(S.String),
  status: S.Literals(["active", "disabled", "expired"]),
});
export interface Token extends S.Schema.Type<typeof Token> {}

export const ZoneListEnvelope = S.Struct({
  errors: S.Array(ErrorDetail),
  messages: S.Array(Message),
  result: S.Array(Zone),
  result_info: S.optionalKey(ResultInfo),
  success: S.Boolean,
});
export const RecordListEnvelope = S.Struct({
  errors: S.Array(ErrorDetail),
  messages: S.Array(Message),
  result: S.Array(Record),
  result_info: S.optionalKey(ResultInfo),
  success: S.Boolean,
});
export const RecordEnvelope = S.Struct({
  errors: S.Array(ErrorDetail),
  messages: S.Array(Message),
  result: Record,
  success: S.Boolean,
});
export const TokenEnvelope = S.Struct({
  errors: S.Array(ErrorDetail),
  messages: S.Array(Message),
  result: Token,
  success: S.Boolean,
});
