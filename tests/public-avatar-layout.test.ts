import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function declarationsFor(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = css.matchAll(new RegExp(escapedSelector + "\\s*\\{([^}]*)\\}", "g"));
  return Array.from(matches, (match) => match[1]).join("\n");
}

describe("public player avatar layout", () => {
  it("pins uploaded photos to the circular avatar box without clipping the jersey badge", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    const avatar = declarationsFor(css, ".public-avatar");
    const image = declarationsFor(css, ".public-avatar img");

    expect(avatar).toContain("position: relative");
    expect(avatar).toContain("overflow: visible");
    expect(image).toContain("position: absolute");
    expect(image).toContain("inset: 0");
    expect(image).toContain("object-fit: cover");
    expect(image).toContain("border-radius: 50%");
  });
});
