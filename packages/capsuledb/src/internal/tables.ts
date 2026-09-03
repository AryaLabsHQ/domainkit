/**
 * The six tables DomainKit owns, declared once and rendered per dialect by CapsuleDB.
 *
 * Every table carries `owner_id` and every query filters by it: tenancy is a column, not a schema.
 * There are no foreign keys to host tables, and none between DomainKit's own tables either, so a
 * host can add its own in the emitted migration without fighting a constraint the package owns.
 */
import { Schema } from "capsuledb";

export interface Tables {
  readonly authorizations: Schema.Table;
  readonly connections: Schema.Table;
  readonly attachments: Schema.Table;
  readonly continuations: Schema.Table;
  readonly attempts: Schema.Table;
  readonly readiness: Schema.Table;
}

/** Default table prefix. Part of the physical layout, so it is immutable after the first deploy. */
export const DEFAULT_PREFIX = "domainkit";

/**
 * Declare the six tables under `prefix`.
 *
 * `Schema.table` validates every identifier it will quote, so an invalid prefix throws
 * `CapsuleDefinitionError` here rather than reaching a renderer.
 */
export const make = (prefix: string): Tables => ({
  authorizations: Schema.table(`${prefix}_authorizations`, {
    columns: {
      id: Schema.text(),
      owner_id: Schema.text(),
      provider: Schema.text(),
      method: Schema.text(),
      capabilities: Schema.json(),
      context: Schema.json(),
      revocation: Schema.text(),
      created_by: Schema.text(),
      created_at: Schema.timestamp(),
      credential_ciphertext: Schema.text(),
      credential_expires_at: Schema.timestamp({ nullable: true }),
      credential_rotated_at: Schema.timestamp(),
      updated_at: Schema.timestamp(),
    },
    primaryKey: ["id"],
    indexes: [{ columns: ["owner_id", "revocation"] }, { columns: ["owner_id", "provider"] }],
  }),
  connections: Schema.table(`${prefix}_connections`, {
    columns: {
      id: Schema.text(),
      owner_id: Schema.text(),
      authorization_id: Schema.text(),
      created_at: Schema.timestamp(),
    },
    primaryKey: ["id"],
    indexes: [{ columns: ["owner_id"] }, { columns: ["authorization_id"] }],
  }),
  attachments: Schema.table(`${prefix}_attachments`, {
    columns: {
      id: Schema.text(),
      owner_id: Schema.text(),
      connection_id: Schema.text(),
      domain: Schema.text(),
      zone: Schema.text(),
      target: Schema.json(),
      created_at: Schema.timestamp(),
    },
    primaryKey: ["id"],
    // One attachment per domain per tenant; `attachments.create` reads the conflict as InvalidInput.
    uniques: [["owner_id", "domain"]],
    indexes: [{ columns: ["owner_id", "connection_id"] }],
  }),
  continuations: Schema.table(`${prefix}_continuations`, {
    columns: {
      id: Schema.text(),
      owner_id: Schema.text(),
      actor_id: Schema.text(),
      provider: Schema.text(),
      payload: Schema.json(),
      return_to: Schema.text({ nullable: true }),
      expires_at: Schema.timestamp(),
    },
    primaryKey: ["id"],
    // Hosts sweep expired rows on this index; consume deletes the row it returns.
    indexes: [{ columns: ["expires_at"] }],
  }),
  attempts: Schema.table(`${prefix}_attempts`, {
    columns: {
      id: Schema.text(),
      owner_id: Schema.text(),
      attachment_id: Schema.text(),
      kind: Schema.text(),
      status: Schema.text(),
      plan: Schema.json(),
      approval: Schema.json({ nullable: true }),
      /** Denormalized from `approval` so `byApproval` is an index lookup. */
      approval_id: Schema.text({ nullable: true }),
      receipt: Schema.json({ nullable: true }),
      /** Denormalized from `receipt` so `byReceipt` is an index lookup. */
      receipt_id: Schema.text({ nullable: true }),
      /** Who declined the plan, why, and when; set when an attempt reaches `rejected`. */
      rejection: Schema.json({ nullable: true }),
      source_receipt_id: Schema.text({ nullable: true }),
      lease_expires_at: Schema.timestamp({ nullable: true }),
      failure: Schema.text({ nullable: true }),
      /** The plan's own `createdAt`; `latest` orders by it. */
      plan_created_at: Schema.timestamp(),
      updated_at: Schema.timestamp(),
    },
    primaryKey: ["id"],
    indexes: [
      { columns: ["owner_id", "attachment_id", "kind"] },
      { columns: ["owner_id", "approval_id"] },
      { columns: ["owner_id", "receipt_id"] },
    ],
  }),
  readiness: Schema.table(`${prefix}_readiness`, {
    columns: {
      attachment_id: Schema.text(),
      owner_id: Schema.text(),
      overall: Schema.text(),
      requirements: Schema.json(),
      host: Schema.json(),
      pending_since: Schema.timestamp({ nullable: true }),
      checked_at: Schema.timestamp(),
      next_check_at: Schema.timestamp({ nullable: true }),
    },
    // Readiness is keyed by attachment, not by attempt, so observe-only hosts still get a row.
    primaryKey: ["attachment_id"],
    indexes: [{ columns: ["owner_id", "next_check_at"] }],
  }),
});

export const list = (tables: Tables): ReadonlyArray<Schema.Table> => [
  tables.authorizations,
  tables.connections,
  tables.attachments,
  tables.continuations,
  tables.attempts,
  tables.readiness,
];
