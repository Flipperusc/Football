import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequestErrorMessage, requestJson } from "@/lib/client-types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("returns undefined for a successful DELETE response with no content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(
      requestJson<void>("/api/players/p1/aliases/a1", { method: "DELETE" })
    ).resolves.toBeUndefined();
  });

  it("reports AI unavailability when an API response uses the local fallback", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "CustomEvent",
      class TestCustomEvent {
        constructor(
          public type: string,
          public init: { detail: { available: boolean } }
        ) {}
      }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ parsed: {}, usedFallback: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await requestJson("/api/roster/parse", { method: "POST" });

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
      type: "football:ai-availability",
      init: { detail: { available: false } }
    });
  });
});

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
