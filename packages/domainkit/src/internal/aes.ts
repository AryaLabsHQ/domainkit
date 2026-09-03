import { Effect, Redacted } from "effect";

import * as DomainKitError from "../DomainKitError.ts";

const version = "v1";
const ivBytes = 12;

const cryptoFailed = (operation: "seal" | "open") => () =>
  new DomainKitError.DomainKitError({
    reason: new DomainKitError.CryptoFailed({ operation }),
  });

/** Accepts a 32-byte key as base64, base64url, or hex. */
export const decodeKey = (encoded: string): Uint8Array<ArrayBuffer> | null => {
  const trimmed = encoded.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Uint8Array.from(trimmed.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  }
  try {
    const bytes = fromBase64(trimmed);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
};

export const importKey = (
  raw: Uint8Array<ArrayBuffer>,
): Effect.Effect<CryptoKey, DomainKitError.DomainKitError> =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
    catch: cryptoFailed("seal"),
  });

export const seal = (
  key: CryptoKey,
  plaintext: Redacted.Redacted<string>,
): Effect.Effect<string, DomainKitError.DomainKitError> =>
  Effect.tryPromise({
    try: async () => {
      const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(Redacted.value(plaintext)),
        ),
      );
      return `${version}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
    },
    catch: cryptoFailed("seal"),
  });

export const open = (
  key: CryptoKey,
  envelope: string,
): Effect.Effect<Redacted.Redacted<string>, DomainKitError.DomainKitError> =>
  Effect.tryPromise({
    try: async () => {
      const [tag, iv, ciphertext] = envelope.split(".");
      if (tag !== version || iv === undefined || ciphertext === undefined) {
        throw new Error("unsupported envelope");
      }
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        key,
        fromBase64(ciphertext),
      );
      return Redacted.make(new TextDecoder().decode(plaintext));
    },
    catch: cryptoFailed("open"),
  });

export const generateKey = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
