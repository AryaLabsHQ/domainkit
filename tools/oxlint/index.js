import { noForeignPromiseOutsideBoundary, noRuntimeExit } from "./effect-boundaries.js";

export default {
  meta: { name: "domainkit" },
  rules: {
    "no-foreign-promise-outside-boundary": noForeignPromiseOutsideBoundary,
    "no-runtime-exit": noRuntimeExit,
  },
};
