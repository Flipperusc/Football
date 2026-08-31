import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlayerListWithAi } from "@/lib/ai/player-list";

const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const previousDeepSeekMaxTokens = process.env.DEEPSEEK_MAX_TOKENS;

const sampleNames = [
  "宇哥",
  "道长",
  "俊锟",
  "康饼",
  "曾琦",
  "柳旭",
  "蒲蒲",
  "雷多鱼",
  "十三",
  "王龙",
  "老游",
  "摩托",
  "懂事长",
  "周杰",
  "尚涛",
  "老李",
  "雪子",
  "果之林",
  "红犀牛",
  "保国",
  "陈少",
  "欧巴",
  "小何",
  "AD钙",
  "星光",
  "阿宗",
  "小庄",
  "丁飞",
  "阿比比",
  "平律",
  "万邦",
  "老鱼",
  "费佳佳",
  "毛老师",
  "万新",
  "眼镜哥",
  "大熊",
  "BOBO",
  "佳楠",
  "席颖峰",
  "谢欣成",
  "佳哥",
  "万鹏",
  "刘志",
  "应帧",
  "明哥",
  "大圣",
  "树哥",
  "聂老师"
];

describe("player list parsing", () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (previousDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
    if (previousDeepSeekMaxTokens) {
      process.env.DEEPSEEK_MAX_TOKENS = previousDeepSeekMaxTokens;
    } else {
      delete process.env.DEEPSEEK_MAX_TOKENS;
    }
  });

  it("parses one-player-per-line team lists including mixed Chinese and English names", async () => {
    const result = await parsePlayerListWithAi({ rawText: sampleNames.join("\n") });

    expect(result.usedFallback).toBe(true);
    expect(result.parsed.players.map((player) => player.name)).toEqual(sampleNames);
  });

  it("ignores pure number lines and list numbers", async () => {
    const result = await parsePlayerListWithAi({
      rawText: ["1. 宇哥", "10", "2、AD钙", "BOBO"].join("\n")
    });

    expect(result.parsed.players.map((player) => player.name)).toEqual(["宇哥", "AD钙", "BOBO"]);
  });

  it("uses non-thinking mode and the configured output limit for DeepSeek player-list parsing", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_MAX_TOKENS = "4096";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ players: [{ name: "宇哥" }] }) }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parsePlayerListWithAi({ rawText: "宇哥" });

    expect(result.usedFallback).toBe(false);
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody.max_tokens).toBe(4096);
  });
});
