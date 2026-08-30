import { readFileSync } from "node:fs";

const styles = readFileSync("src/styles.css", "utf8");

describe("theme stylesheet contract", () => {
  it("does not reference undefined DomainKit variables", () => {
    const definitions = new Set(styles.match(/--domainkit-[a-z0-9-]+(?=\s*:)/g) ?? []);
    const references = new Set(styles.match(/(?<=var\()--domainkit-[a-z0-9-]+/g) ?? []);

    expect([...references].filter((variable) => !definitions.has(variable))).toEqual([]);
  });

  it("uses semantic tokens for themed color declarations", () => {
    expect(styles).toContain("background: var(--domainkit-backdrop)");
    expect(styles).toContain("color: var(--domainkit-danger-contrast)");
    expect(styles).toContain("color: var(--domainkit-text)");
    expect(styles).not.toContain("var(--domainkit-foreground)");
  });
});
