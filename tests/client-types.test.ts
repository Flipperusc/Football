import { describe, expect, it } from "vitest";
import { getRequestErrorMessage } from "@/lib/client-types";

describe("getRequestErrorMessage", () => {
  it("uses the API error message when available", () => {
    expect(getRequestErrorMessage(new Error("球员名称已存在"), "新增球员失败")).toBe(
      "球员名称已存在"
    );
  });

  it("uses the operation fallback for non-Error values", () => {
    expect(getRequestErrorMessage("unknown", "保存球员别名失败")).toBe("保存球员别名失败");
  });
});
