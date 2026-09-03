import assert from "node:assert/strict";

import { stateFromDials } from "../islands/react-catalog/preview-dials.ts";
import { seedOf, stateFromSearch, storyKey } from "../islands/react-catalog/preview-state.ts";

/**
 * The component previews run the real lifecycle against a fake server built from the dial values.
 * `storyKey` decides when that server is replaced and the flow remounts with it, so a value the key
 * misses leaves a controller holding a connection, a plan, or readiness the new server never
 * issued. That has regressed twice; these cases pin it.
 */
const initial = stateFromSearch("?story=domain-flow");
const base = storyKey(initial);

const edit = (values: Parameters<typeof stateFromDials>[1]) =>
  storyKey(stateFromDials(initial, values));

// A re-render with no edit rebuilds the requirement array, and the story must survive it.
assert.equal(edit({}), base, "an untouched dial panel restarts the story");

assert.notEqual(
  edit({ records: { cname: { target: "other.acme.dev" } } }),
  base,
  "editing the CNAME target leaves the previous readiness on screen",
);

assert.notEqual(
  edit({ records: { cname: { name: "www.example.com" } } }),
  base,
  "editing the CNAME name leaves the previous readiness on screen",
);

assert.notEqual(
  edit({ records: { txt: { value: "acme-verify=0000" } } }),
  base,
  "editing the TXT value leaves the provider holding the old record",
);

assert.notEqual(edit({ seeded: false }), base, "clearing the seed keeps the seeded plan");
assert.notEqual(edit({ provider: "vercel" }), base, "switching provider keeps the old connection");
assert.notEqual(edit({ oauth: false }), base, "dropping OAuth keeps the old connect methods");

// The seed is the records the zone already holds, which is the TXT requirement and nothing else.
assert.deepEqual(
  seedOf(initial).map((record) => record._tag),
  ["TXT"],
  "the seeded zone holds the TXT requirement",
);
assert.deepEqual(seedOf(stateFromDials(initial, { seeded: false })), [], "an empty zone is empty");

console.log("Preview story keys cover every editable input.");
