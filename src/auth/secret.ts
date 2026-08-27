/** A deliberately non-serializable credential value. */
export class Secret {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static from(value: string): Secret {
    if (value.length === 0) throw new Error("Secret values cannot be empty");
    return new Secret(value);
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
