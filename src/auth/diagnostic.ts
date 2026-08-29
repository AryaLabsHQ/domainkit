import { Schema } from "effect";

export const Category = Schema.Literals([
  "authorization",
  "configuration",
  "provider",
  "storage",
  "validation",
]);
export type Category = typeof Category.Type;

export const RetryAdvice = Schema.Literals(["never", "after-user-action", "safe", "unknown"]);
export type RetryAdvice = typeof RetryAdvice.Type;

export const Fields = {
  category: Category,
  message: Schema.String,
  operation: Schema.String,
  retry: RetryAdvice,
} as const;

export interface Diagnostic {
  readonly category: Category;
  readonly message: string;
  readonly operation: string;
  readonly retry: RetryAdvice;
  readonly tag: string;
}

export function from(error: {
  readonly _tag: string;
  readonly category: Category;
  readonly message: string;
  readonly operation: string;
  readonly retry: RetryAdvice;
}): Diagnostic {
  return {
    category: error.category,
    message: error.message,
    operation: error.operation,
    retry: error.retry,
    tag: error._tag,
  };
}
