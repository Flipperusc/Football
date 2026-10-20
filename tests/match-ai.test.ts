import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMatchWithAi } from "@/lib/ai/deepseek";
import type { InternalParseResult, ParseResult } from "@/lib/ai/schemas";
import type { ParserPlayer } from "@/lib/ai/local-parser";
import { localParseMatch } from "@/lib/ai/local-parser";
import { inspectInternalEvents } from "@/lib/match-events";

const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const previousDeepSeekMaxTokens = process.env.DEEPSEEK_MAX_TOKENS;

const players: ParserPlayer[] = [
  { id: "p1", name: "\u5b87\u54e5", aliases: [] },
  { id: "p2", name: "\u9053\u957f", aliases: [] }
];

const teamAssignments = [
  { playerId: "p1", teamColor: "WHITE" as const },
  { playerId: "p2", teamColor: "WHITE" as const }
];

function expectInternalParsed(parsed: ParseResult): InternalParseResult {
  expect(parsed.matchType).toBe("internal");
  if (parsed.matchType !== "internal") throw new Error("Expected internal parse result");
  return parsed;
}

function mockDeepSeek(content: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal(
    "fetch",
    fetchMock
  );
  return fetchMock;
}

describe("post-match AI parsing", () => {
  it("preserves an explicit score when an unmarked guest conflicts with the roster", async () => {
    const rawText = "第一节白蓝0:1宇哥进球";
    mockDeepSeek({ matchType: "internal", games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 1, rawText,
      goals: [{ scorerName: "宇哥", team: "blue", rawText: "宇哥进球" }] }] });
    const result = await parseMatchWithAi({ rawText, matchType: "INTERNAL", players, teamAssignments });
    const parsed = expectInternalParsed(result.parsed);
    expect(parsed.games[0]).toMatchObject({ scoreA: 0, scoreB: 1 });
    expect(parsed.games[0].events[0].needsReview).toBe(true);
    expect(inspectInternalEvents(parsed, teamAssignments).issues[0]).toContain("已记录进球超过");
  });

  it("uses the explicitly represented team when AI contradicts the guest text", async () => {
    mockDeepSeek({ matchType: "internal", games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 1, scoreB: 1,
      goals: [{ scorerName: "宇哥", team: "white", isGuest: true, rawText: "宇哥替蓝队进球" }] }] });
    const result = await parseMatchWithAi({ rawText: "第一节白蓝1:1宇哥替蓝队进球", matchType: "INTERNAL", players, teamAssignments });
    const parsed = expectInternalParsed(result.parsed);
    expect(parsed.games[0].events[0].team).toBe("blue");
    expect(inspectInternalEvents(parsed, teamAssignments).exceptions[0].reasons).toContain("SCORER_GUEST");
  });

  it("does not silently accept an ambiguous guest as an ordinary original-team goal", async () => {
    mockDeepSeek({ matchType: "internal", games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 1, scoreB: 1,
      goals: [{ scorerName: "宇哥", team: "white", isGuest: true, rawText: "宇哥临时代打进球" }] }] });
    const result = await parseMatchWithAi({ rawText: "第一节白蓝1:1宇哥临时代打进球", matchType: "INTERNAL", players, teamAssignments });
    const parsed = expectInternalParsed(result.parsed);
    expect(parsed.games[0].events[0]).toMatchObject({ needsTeamSelection: true });
    expect(parsed.games[0].events[0].team).toBeUndefined();
    expect(inspectInternalEvents(parsed, teamAssignments).exceptions[0].reasons).toContain("TEAM_REQUIRED");
  });

  it.each(["，", " ", ""])("does not give an unknown player's own goal to the previous scorer (separator: %j)", (separator) => {
    const parsed = expectInternalParsed(localParseMatch({ rawText: `第一节白蓝1:1宇哥进球${separator}小明乌龙，蓝队得分`, matchType: "INTERNAL", players, teamAssignments }));
    expect(parsed.games[0].events).toEqual([expect.objectContaining({ type: "goal", team: "white", scorer: expect.objectContaining({ playerId: "p1" }) })]);
    expect(parsed.uncertainItems).toEqual(expect.arrayContaining([expect.objectContaining({ rawText: expect.stringContaining("小明乌龙"), reason: expect.stringContaining("乌龙球球员未识别") })]));
  });

  it("preserves explicit AI guest goals and own goals without swapping the score", async () => {
    mockDeepSeek({ matchType: "internal", games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 2,
      goals: [
        { scorerName: "宇哥", team: "blue", isGuest: true, rawText: "宇哥替蓝队进球" },
        { type: "own_goal", scorerName: "道长", team: "blue", rawText: "道长乌龙，蓝队得分" }
      ] }] });
    const result = await parseMatchWithAi({ rawText: "第一节白蓝0:2宇哥替蓝队进球，道长乌龙，蓝队得分", matchType: "INTERNAL", players, teamAssignments });
    const game = expectInternalParsed(result.parsed).games[0];
    expect(game).toMatchObject({ scoreA: 0, scoreB: 2 });
    expect(game.events[0]).toMatchObject({ type: "goal", team: "blue", needsReview: true });
    expect(game.events[1]).toMatchObject({ type: "own_goal", team: "blue", assist: null, needsReview: true });
  });

  it("locally recognizes a guest goal and an own goal in one section", () => {
    const parsed = expectInternalParsed(localParseMatch({ rawText: "第一节白蓝0:2宇哥替蓝队进球，道长乌龙，蓝队得分", matchType: "INTERNAL", players, teamAssignments }));
    expect(parsed.games[0]).toMatchObject({ scoreA: 0, scoreB: 2 });
    expect(parsed.games[0].events).toHaveLength(2);
    expect(parsed.games[0].events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "goal", team: "blue", scorer: expect.objectContaining({ playerId: "p1" }) }),
      expect.objectContaining({ type: "own_goal", team: "blue", assist: null, scorer: expect.objectContaining({ playerId: "p2" }) })
    ]));
  });

  it("leaves ambiguous guest attribution for a human instead of falling back to the original team", () => {
    const parsed = expectInternalParsed(localParseMatch({ rawText: "第一节白蓝0:1宇哥临时代打进球", matchType: "INTERNAL", players, teamAssignments }));
    expect(parsed.games[0].events[0]).toMatchObject({ needsTeamSelection: true, needsReview: true });
    expect(parsed.games[0].events[0].team).toBeUndefined();
  });

  it("keeps a player's ordinary goal separate from their own goal", () => {
    const parsed = expectInternalParsed(localParseMatch({ rawText: "第一节白蓝1:1宇哥进球，宇哥乌龙，蓝队得分", matchType: "INTERNAL", players, teamAssignments }));
    expect(parsed.games[0].events).toHaveLength(2);
    expect(parsed.games[0].events.map((event) => event.type).sort()).toEqual(["goal", "own_goal"]);
  });
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_MAX_TOKENS = "4096";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

  it("turns clean DeepSeek facts into the full confirmation schema", async () => {
    const fetchMock = mockDeepSeek({
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
    const parsed = expectInternalParsed(result.parsed);
    expect(parsed.games).toHaveLength(6);
    expect(parsed.games[0]).toMatchObject({
      sectionNo: 1,
      teamA: "white",
      teamB: "blue",
      scoreA: 1,
      scoreB: 0
    });
    expect(parsed.games[0].events[0].scorer.playerId).toBe("p1");
    expect(parsed.games[0].events[0].assist?.playerId).toBe("p2");
    expect(parsed.bonusPoints[0].player.playerId).toBe("p1");
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody.max_tokens).toBe(4096);
  });

  it("uses roster assignments instead of conflicting AI team guesses", async () => {
    mockDeepSeek({
      matchType: "internal",
      games: [
        {
          sectionNo: 1,
          teamA: "white",
          teamB: "blue",
          scoreA: 0,
          scoreB: 1,
          rawText: "第一节 1:0 道长助攻宇哥",
          goals: [
            {
              team: "blue",
              scorerName: "宇哥",
              assistName: "道长",
              count: 1,
              rawText: "道长助攻宇哥"
            }
          ]
        }
      ],
      bonusPoints: [],
      awards: [],
      uncertainItems: []
    });

    const result = await parseMatchWithAi({
      rawText: "第一节 1:0 道长助攻宇哥",
      matchType: "INTERNAL",
      players,
      teamAssignments
    });

    const parsed = expectInternalParsed(result.parsed);
    expect(parsed.games[0].events[0]).toMatchObject({
      team: "white",
      needsReview: false
    });
    expect(parsed.games[0]).toMatchObject({ scoreA: 1, scoreB: 0 });
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
    const parsed = expectInternalParsed(result.parsed);
    expect(parsed.games[0].sectionNo).toBe(1);
    expect(parsed.games[0].scoreA).toBe(1);
    expect(parsed.games[0].events[0].scorer.playerId).toBe("p1");
    expect(parsed.games[0].events[0].assist?.playerId).toBe("p2");
  });

  it("does not switch to local rules when a configured DeepSeek key fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      parseMatchWithAi({
        rawText: "第一节白蓝1:0",
        matchType: "INTERNAL",
        players,
        teamAssignments
      })
    ).rejects.toMatchObject({ code: "AI_AUTH_FAILED" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("splits best defender awards without bonus points", async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const result = await parseMatchWithAi({
      rawText: "最佳后卫：欧巴，果子林",
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
      points: 0
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
