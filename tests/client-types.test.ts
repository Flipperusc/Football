import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, getRequestErrorMessage, requestJson } from "@/lib/client-types";

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

  it("turns an nginx HTML 504 into a Chinese match-parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body><h1>504 Gateway Time-out</h1></body></html>", {
          status: 504,
          headers: { "Content-Type": "text/html" }
        })
      )
    );

    const error = await requestJson("/api/matchdays/m1/parse", { method: "POST" }).catch(
      (caught) => caught
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    if (!(error instanceof ApiRequestError)) throw new Error("Expected ApiRequestError");
    expect(error).toMatchObject({
      status: 504,
      message: "服务器等待 DeepSeek 响应超时。比赛信息已经保存，请点击“重新解析”再次尝试。"
    });
    expect(error.message).not.toContain("<html>");
  });

  it("preserves structured API status and error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "DeepSeek 请求过多，请稍后重试。", code: "AI_RATE_LIMITED" }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const error = await requestJson("/api/roster/parse", { method: "POST" }).catch(
      (caught) => caught
    );

    expect(error).toMatchObject({ status: 429, code: "AI_RATE_LIMITED" });
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
