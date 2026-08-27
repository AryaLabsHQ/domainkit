import * as DnsOverHttps from "../verification/doh.ts";
import type * as DnsResolver from "../verification/resolver.ts";

export type Options = DnsOverHttps.Options;

export function make(options: Options): DnsResolver.AsyncInterface {
  return DnsOverHttps.toAsync(options);
}
