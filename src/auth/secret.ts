/** A deliberately non-serializable credential value. */
export class Value {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static from(value: string): Value {
    if (value.length === 0) throw new Error("Secret values cannot be empty");
    return new Value(value);
  }

  expose(): string {
    return this.#value;
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  toString(): string {
    return "[REDACTED]";
  }
}

export const make = Value.from;
