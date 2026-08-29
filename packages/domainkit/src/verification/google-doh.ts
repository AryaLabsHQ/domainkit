import { Layer } from "effect";

import * as DnsOverHttps from "./doh.ts";
import * as DnsResolver from "./resolver.ts";

const endpoint = "https://dns.google/dns-query";

export interface Options extends Omit<DnsOverHttps.Options, "endpoint"> {
  readonly endpoint?: string;
}

export function make(options: Options = {}): DnsResolver.Interface {
  return DnsOverHttps.make({ ...options, endpoint: options.endpoint ?? endpoint });
}

export const layer = (options: Options = {}): Layer.Layer<DnsResolver.Service> =>
  Layer.succeed(DnsResolver.Service, make(options));

export const toAsync = (options: Options = {}): DnsResolver.AsyncInterface =>
  DnsResolver.toAsync(make(options));
