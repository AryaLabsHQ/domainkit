import assert from "node:assert/strict";

import { markerOf, snippet } from "../components/snippets.ts";

/**
 * Every code sample on the site is a region of a file that compiles in CI, so the reader that
 * slices them decides what a page shows. A marker matched loosely renders the wrong example
 * silently: eight region names in the gallery are prefixes of another (`connect` and
 * `connect-token`, `token` and `token-only`, `hook` and `hooks`, ...).
 */
assert.deepEqual(markerOf("// #region program"), { kind: "region", name: "program" });
assert.deepEqual(markerOf("  // #region program"), { kind: "region", name: "program" });
assert.deepEqual(markerOf("// #endregion program"), { kind: "endregion", name: "program" });
assert.deepEqual(markerOf("// #endregion"), { kind: "endregion", name: null });
assert.deepEqual(markerOf("/* #region layer */"), { kind: "region", name: "layer" });
assert.deepEqual(markerOf("/* #endregion layer */"), { kind: "endregion", name: "layer" });

assert.equal(markerOf("const region = 1;"), null);
assert.equal(markerOf("// a comment about #region naming"), null);
assert.equal(markerOf("// #regionish name"), null, "a marker is a whole word");

// A requested name is the whole name, never a prefix of a longer one.
assert.equal(
  snippet("examples/providers/cloudflare.ts", "token-only").includes("Connect.start"),
  false,
  "`token-only` renders the definition, not the connect call below it",
);
assert.equal(
  snippet("examples/providers/cloudflare.ts", "connect-token").includes("Connect.start"),
  true,
  "`connect-token` renders the connect call",
);

// The whole-file form drops the markers and nothing else.
const whole = snippet("packages/domainkit/examples/effect/quickstart.ts");
assert.equal(whole.includes("#region"), false, "a whole file carries no markers");
assert.equal(whole.includes("Provision.approve"), true, "a whole file carries its code");

assert.throws(
  () => snippet("examples/core/plans.ts", "nope"),
  /has no region nope/,
  "a missing region fails the build rather than rendering nothing",
);
assert.throws(
  () => snippet("packages/react/src/index.ts", "anything"),
  /outside the typechecked example trees/,
  "only the gated example trees are readable",
);

console.log("Snippet regions match whole marker names.");
