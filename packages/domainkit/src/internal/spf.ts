/** RFC 7208 version selection only; full SPF policy validation belongs to the host. */
export const isSpf = (value: string): boolean =>
  value.slice(0, 6).toLowerCase() === "v=spf1" && (value.length === 6 || value[6] === " ");
