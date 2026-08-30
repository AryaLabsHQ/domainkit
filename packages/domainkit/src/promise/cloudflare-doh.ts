import * as CloudflareDnsOverHttps from "../verification/cloudflare-doh.ts";
import type * as DnsResolver from "../verification/resolver.ts";

export type Options = CloudflareDnsOverHttps.Options;

export function make(options: Options = {}): DnsResolver.AsyncInterface {
  return CloudflareDnsOverHttps.toAsync(options);
}
