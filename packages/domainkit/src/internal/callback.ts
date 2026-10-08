import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";

/** A leaked flow id must reveal neither existence nor ownership, including read races. */
export const refuse = Errors.fail(
  new Reason.InvalidInput({
    message: "This callback does not match a connection you started",
    field: "state",
  }),
);
export const missing = (error: Errors.DomainKitError): boolean =>
  error.reason._tag === "NotFound" || error.reason._tag === "Expired";
