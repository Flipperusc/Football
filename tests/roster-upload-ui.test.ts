import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("roster image upload UI", () => {
  it("supports both click selection and drag-and-drop uploads", () => {
    const source = readFileSync(resolve(process.cwd(), "components/MatchEntryForm.tsx"), "utf8");

    expect(source).toContain("<AntUpload.Dragger");
    expect(source).toContain("beforeUpload={(file) => {");
    expect(source).toContain("点击或将分队照片拖到此处");
    expect(source).toContain("replaceGoalkeepers: true");
    expect(source).not.toContain("rosterImageInputRef");
  });
});
