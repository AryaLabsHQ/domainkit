import { Schema as S } from "effect";

export const Pagination = S.Struct({
  count: S.Number,
  next: S.NullOr(S.Number),
  prev: S.NullOr(S.Number),
});
export interface Pagination extends S.Schema.Type<typeof Pagination> {}

export const ErrorDetail = S.Struct({
  code: S.String,
  message: S.String,
  limit: S.optionalKey(
    S.Struct({
      remaining: S.Number,
      reset: S.optionalKey(S.Number),
      resetMs: S.optionalKey(S.Number),
      total: S.Number,
    }),
  ),
});
export interface ErrorDetail extends S.Schema.Type<typeof ErrorDetail> {}

export const ErrorEnvelope = S.Struct({ error: ErrorDetail });

export const User = S.Struct({
  id: S.String,
  name: S.NullOr(S.String),
  username: S.String,
});
export interface User extends S.Schema.Type<typeof User> {}

export const UserEnvelope = S.Struct({ user: User });

export const Team = S.Struct({
  id: S.String,
  name: S.NullOr(S.String),
  slug: S.String,
});
export interface Team extends S.Schema.Type<typeof Team> {}

export const TeamListEnvelope = S.Struct({
  pagination: Pagination,
  teams: S.Array(Team),
});

export const Domain = S.Struct({
  id: S.String,
  intendedNameservers: S.Array(S.String),
  name: S.String,
  nameservers: S.Array(S.String),
  serviceType: S.Literals(["zeit.world", "external", "na"]),
  teamId: S.NullOr(S.String),
  userId: S.String,
  verified: S.Boolean,
});
export interface Domain extends S.Schema.Type<typeof Domain> {}

export const DomainConfig = S.Struct({
  misconfigured: S.Boolean,
  serviceType: S.Literals(["zeit.world", "external", "na"]),
});
export interface DomainConfig extends S.Schema.Type<typeof DomainConfig> {}

export const DomainEnvelope = S.Struct({ domain: Domain });

export const DomainListEnvelope = S.Struct({
  domains: S.Array(Domain),
  pagination: Pagination,
});

export const Record = S.Struct({
  id: S.String,
  mxPriority: S.optionalKey(S.Number),
  name: S.String,
  priority: S.optionalKey(S.Number),
  ttl: S.optionalKey(S.Number),
  type: S.String,
  value: S.String,
});
export interface Record extends S.Schema.Type<typeof Record> {}

export const RecordListEnvelope = S.Struct({
  pagination: S.optionalKey(Pagination),
  records: S.Array(Record),
});

export const CreateRecordEnvelope = S.Struct({
  uid: S.String,
  updated: S.optionalKey(S.Number),
});

export const IntegrationToken = S.Struct({
  access_token: S.String,
  installation_id: S.optionalKey(S.String),
  team_id: S.NullOr(S.String),
  token_type: S.optionalKey(S.String),
  user_id: S.String,
});
export interface IntegrationToken extends S.Schema.Type<typeof IntegrationToken> {}
