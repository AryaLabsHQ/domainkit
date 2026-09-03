import { Config, Layer, Redacted } from "effect";
import { PgClient } from "@effect/sql-pg";
import { Cloudflare, Custody, DomainKit, Vercel } from "domainkit";
import { PgStorage } from "@domainkit/capsuledb";

// #region wire
/**
 * `PgStorage.layer()` prepares at boot: it creates CapsuleDB's ledger, applies pending migrations,
 * and only then provides `Storage`. Nothing can observe a database whose tables are missing.
 */
export const DomainKitLive = DomainKit.layer({
  providers: [
    Cloudflare.provider({
      oauth: {
        clientId: Config.string("CF_CLIENT_ID"),
        clientSecret: Config.redacted("CF_CLIENT_SECRET"),
      },
    }),
    Vercel.provider(),
  ],
}).pipe(
  // `provideMerge`, not `provide`: the route handlers read attempts and receipts straight from
  // Storage, so the layer they are given has to still carry it.
  Layer.provideMerge(Layer.mergeAll(PgStorage.layer(), Custody.layerConfig())),
  Layer.provide(PgClient.layerConfig({ url: Config.redacted("DATABASE_URL") })),
);
// #endregion wire

// #region assert
/**
 * When migrations are yours to run, apply the `capsuledb emit` output with your own pipeline and
 * boot in assert mode: it changes no schema and fails unless the database already matches.
 */
export const Asserted = PgStorage.layer({ mode: "assert" });
// #endregion assert

// #region prefix
/**
 * The table prefix is part of the physical layout: it changes the rendered DDL and the migration
 * checksum, so fix it before the first deploy. `registryPrefix` does the same for CapsuleDB's own
 * ledger and must match `capsuledb emit --prefix`.
 */
export const Prefixed = PgStorage.layer({ prefix: "acme_dns", registryPrefix: "acme_capsules" });
// #endregion prefix

// #region custody
/** `layerConfig` reads a 32-byte key from `DOMAINKIT_CUSTODY_KEY`. There is no plaintext mode. */
export const CustodyLive = Custody.layerConfig();

/** Hand sealing to a KMS instead; the rest of the lifecycle does not change. */
export const CustodyKms = Custody.layerFromAsync({
  seal: (plaintext) => kms.encrypt(plaintext),
  open: (ciphertext) => kms.decrypt(ciphertext),
});

/** A fresh key in the accepted encoding, for a first deploy or a local playground. */
export const newKey = Redacted.make(Custody.generateKey());
// #endregion custody

// #region memory
/** Tests and playgrounds take the in-memory pair through one layer. */
export const Playground = DomainKit.layerMemory({ providers: [Vercel.provider()] });
// #endregion memory

declare const kms: {
  readonly encrypt: (plaintext: string) => Promise<string>;
  readonly decrypt: (ciphertext: string) => Promise<string>;
};
