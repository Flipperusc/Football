import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMatchWithAi } from "@/lib/ai/deepseek";
import type { ParserPlayer } from "@/lib/ai/local-parser";

const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;

const players: ParserPlayer[] = [
  { id: "p1", name: "\u5b87\u54e5", aliases: [] },
  { id: "p2", name: "\u9053\u957f", aliases: [] }
];

const teamAssignments = [
  { playerId: "p1", teamColor: "WHITE" as const },
  { playerId: "p2", teamColor: "WHITE" as const }
];

function mockDeepSeek(content: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(content) } }]
      })
    }))
  );
}

describe("post-match AI parsing", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("turns clean DeepSeek facts into the full confirmation schema", async () => {
    mockDeepSeek({
      matchType: "internal",
      games: [
        {
          sectionNo: 1,
          teamA: "white",
          teamB: "blue",
          scoreA: 1,
          scoreB: 0,
          rawText: "\u7b2c\u4e00\u8282 \u767d\u84dd 1:0 \u9053\u957f\u52a9\u653b\u5b87\u54e5",
          goals: [
            {
              team: "white",
              scorerName: "\u5b87\u54e5",
              assistName: "\u9053\u957f",
              count: 1,
              rawText: "\u9053\u957f\u52a9\u653b\u5b87\u54e5"
            }
          ]
        }
      ],
      bonusPoints: [
        {
          playerName: "\u5b87\u54e5",
          points: 1,
          reason: "\u52a0\u4e00\u5206",
          rawText: "\u5b87\u54e5\u52a0\u4e00\u5206"
        }
      ],
      awards: [],
      uncertainItems: []
    });

    const result = await parseMatchWithAi({
      rawText: "\u7b2c\u4e00\u8282 \u767d\u84dd 1:0 \u9053\u957f\u52a9\u653b\u5b87\u54e5",
      matchType: "INTERNAL",
      players,
      teamAssignments
    });

    expect(result.usedFallback).toBe(false);
    expect(result.parsed.matchType).toBe("internal");
    expect(result.parsed.games).toHaveLength(6);
    expect(result.parsed.games[0]).toMatchObject({
      sectionNo: 1,
      teamA: "white",
      teamB: "blue",
      scoreA: 1,
      scoreB: 0
    });
    expect(result.parsed.games[0].events[0].scorer.playerId).toBe("p1");
    expect(result.parsed.games[0].events[0].assist?.playerId).toBe("p2");
    expect(result.parsed.bonusPoints[0].player.playerId).toBe("p1");
  });

  it("salvages old database-shaped DeepSeek output with missing confidence fields", async () => {
    mockDeepSeek({
      matchType: "internal",
      games: [
        {
          section: "\u7b2c\u4e00\u8282",
          teamA: "\u767d",
          teamB: "\u84dd",
          score: "1:0",
          events: [
            {
              scorer: { rawName: "\u5b87\u54e5" },
              assist: { rawName: "\u9053\u957f" },
              rawText: "\u9053\u957f\u52a9\u653b\u5b87\u54e5"
            }
          ]
        }
      ],
      bonusPoints: [
        {
          player: { rawName: "\u5b87\u54e5" },
          points: "1",
          reason: "\u52a0\u4e00\u5206"
        }
      ],
      uncertainItems: [{ reason: "\u683c\u5f0f\u4e0d\u5b8c\u6574", candidates: ["\u5b87\u54e5"] }]
    });

    const result = await parseMatchWithAi({
      rawText: "\u7b2c\u4e00\u8282 \u767d\u84dd 1:0 \u9053\u957f\u52a9\u653b\u5b87\u54e5",
      matchType: "INTERNAL",
      players,
      teamAssignments
    });

    expect(result.usedFallback).toBe(false);
    expect(result.parsed.games[0].sectionNo).toBe(1);
    expect(result.parsed.games[0].scoreA).toBe(1);
    expect(result.parsed.games[0].events[0].scorer.playerId).toBe("p1");
    expect(result.parsed.games[0].events[0].assist?.playerId).toBe("p2");
  });

  it("splits best defender awards and gives each player one point", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const result = await parseMatchWithAi({
      rawText: "\u6700\u4f73\u540e\u536b\u6b27\u5df4\u679c\u5b50\u6797",
      matchType: "INTERNAL",
      players: [
        { id: "p3", name: "\u6b27\u5df4", aliases: [] },
        { id: "p4", name: "\u679c\u4e4b\u6797", aliases: [] }
      ],
      teamAssignments: []
    });

    expect(result.usedFallback).toBe(true);
    expect(result.parsed.matchType).toBe("internal");
    expect(result.parsed.awards[0]).toMatchObject({
      name: "\u6700\u4f73\u540e\u536b",
      points: 1
    });
    expect(result.parsed.awards[0].players.map((player) => player.playerId)).toEqual([
      "p3",
      "p4"
    ]);
  });

  it("keeps repeated best defender awards for the same player", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const result = await parseMatchWithAi({
      rawText: "\u6700\u4f73\u540e\u536b\u6b27\u5df4\u6b27\u5df4\u679c\u5b50\u6797",
      matchType: "INTERNAL",
      players: [
        { id: "p3", name: "\u6b27\u5df4", aliases: [] },
        { id: "p4", name: "\u679c\u4e4b\u6797", aliases: [] }
      ],
      teamAssignments: []
    });

    expect(result.usedFallback).toBe(true);
    expect(result.parsed.awards[0].players.map((player) => player.playerId)).toEqual([
      "p3",
      "p3",
      "p4"
    ]);
  });
});
