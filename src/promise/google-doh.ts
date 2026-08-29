import * as GoogleDnsOverHttps from "../verification/google-doh.ts";
import type * as DnsResolver from "../verification/resolver.ts";

export type Options = GoogleDnsOverHttps.Options;

export function make(options: Options = {}): DnsResolver.AsyncInterface {
  return GoogleDnsOverHttps.toAsync(options);
}
