import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekError, requestDeepSeekJson } from "@/lib/ai/deepseek-client";

const originalEnv = {
  key: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL,
  timeout: process.env.DEEPSEEK_ATTEMPT_TIMEOUT_MS,
  maxTokens: process.env.DEEPSEEK_MAX_TOKENS
};

function successResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content }
        }
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 0 }
      }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function request() {
  return requestDeepSeekJson({
    entrypoint: "match-parse",
    prompt: "敏感比赛原文-不要出现在日志",
    parseContent: (content) => JSON.parse(content) as { ok: boolean }
  });
}

describe("shared DeepSeek client", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-secret-key";
    process.env.DEEPSEEK_MODEL = "deepseek-test";
    process.env.DEEPSEEK_ATTEMPT_TIMEOUT_MS = "20";
    process.env.DEEPSEEK_MAX_TOKENS = "1234";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const [name, value] of [
      ["DEEPSEEK_API_KEY", originalEnv.key],
      ["DEEPSEEK_MODEL", originalEnv.model],
      ["DEEPSEEK_ATTEMPT_TIMEOUT_MS", originalEnv.timeout],
      ["DEEPSEEK_MAX_TOKENS", originalEnv.maxTokens]
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("disables thinking, limits output, and logs metadata without prompt or key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse('{"ok":true}'));
    const infoSpy = vi.mocked(console.info);
    const warnSpy = vi.mocked(console.warn);
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).resolves.toMatchObject({
      parsed: { ok: true },
      modelName: "deepseek-test"
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "deepseek-test",
      thinking: { type: "disabled" },
      max_tokens: 1234,
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const logText = JSON.stringify([
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls
    ]);
    expect(logText).toContain("reasoningTokens");
    expect(logText).not.toContain("敏感比赛原文");
    expect(logText).not.toContain("test-secret-key");
  });

  it("supports a vision model override and multimodal user content", async () => {
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const fetchMock = vi.fn().mockResolvedValue(successResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      requestDeepSeekJson({
        entrypoint: "roster-image-ocr",
        prompt: "识别图片中的红蓝白分队名单",
        model: "deepseek-flash",
        userContent: [
          { type: "text", text: "识别图片中的红蓝白分队名单" },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ],
        parseContent: (content) => JSON.parse(content) as { ok: boolean }
      })
    ).resolves.toMatchObject({
      parsed: { ok: true },
      modelName: "deepseek-flash"
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe("deepseek-flash");
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "识别图片中的红蓝白分队名单" },
      { type: "image_url", image_url: { url: imageDataUrl } }
    ]);
  });

  it.each([429, 500, 503])("retries transient HTTP %s once", async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(successResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).resolves.toMatchObject({ parsed: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries invalid JSON once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successResponse("not-json"))
      .mockResolvedValueOnce(successResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).resolves.toMatchObject({ parsed: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries empty content once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successResponse(""))
      .mockResolvedValueOnce(successResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).resolves.toMatchObject({ parsed: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries schema validation failures once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successResponse('{"unexpected":true}'))
      .mockResolvedValueOnce(successResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = requestDeepSeekJson({
      entrypoint: "roster-parse",
      prompt: "schema test",
      parseContent: (content) => {
        const parsed = JSON.parse(content) as { ok?: boolean };
        if (parsed.ok !== true) throw new Error("schema mismatch");
        return parsed;
      }
    });

    await expect(result).resolves.toMatchObject({ parsed: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "AI_AUTH_FAILED"],
    [402, "AI_BALANCE_INSUFFICIENT"],
    [422, "AI_UNAVAILABLE"]
  ] as const)("does not retry non-transient HTTP %s", async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns the typed rate-limit error after two 429 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
      message: "DeepSeek 请求过多，请稍后重试。"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns invalid-response after two unusable results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse("not-json"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts each slow attempt and returns a Chinese timeout error", async () => {
    process.env.DEEPSEEK_ATTEMPT_TIMEOUT_MS = "5";
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      message: "DeepSeek 响应等待超时，请稍后重试。"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a stalled response body as timeout", async () => {
    process.env.DEEPSEEK_ATTEMPT_TIMEOUT_MS = "5";
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("body aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true }
            );
          })
      } as Response)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a generic network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await request().catch((caught) => caught);
    expect(error).toBeInstanceOf(DeepSeekError);
    expect(error).toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
