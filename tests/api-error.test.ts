import { describe, expect, it } from "vitest";
import { DeepSeekError } from "@/lib/ai/deepseek-client";
import { apiErrorResponse } from "@/lib/server/api-error";

describe("API error responses", () => {
  it("preserves DeepSeek status, Chinese message, and code", async () => {
    const response = apiErrorResponse(
      new DeepSeekError({
        code: "AI_BALANCE_INSUFFICIENT",
        message: "DeepSeek 账户余额不足，请充值后重试。",
        status: 402,
        retryable: false,
        upstreamStatus: 402
      })
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      message: "DeepSeek 账户余额不足，请充值后重试。",
      code: "AI_BALANCE_INSUFFICIENT"
    });
  });
});
