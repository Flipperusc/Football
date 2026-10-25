import { describe, expect, it } from "vitest";
import { mergePendingTrials, summarizeTrialEvents, replaceTrialParticipant, formalNameConflict, retainKnownPlayerCorrections, resolveTrialReferences, applyRosterParticipantCorrections } from "@/lib/trial-players";
import { internalParseResultSchema } from "@/lib/ai/schemas";

describe("trial participant editing", () => {
  it("uses match-local corrections when recognizing a roster again after promotion with an edited name", () => {
    const rows = [{ rawName: " 试训甲 ", playerId: null, needsReview: true, teamColor: "BLUE", role: "GOALKEEPER", confidence: 0 }];
    const resolved = applyRosterParticipantCorrections(rows, [{ rawName: "试训甲", playerId: "p1" }], [{ id: "p1", name: "张三" }]);
    expect(resolved).toEqual([{ ...rows[0], playerId: "p1", matchedName: "张三", confidence: 1, needsReview: false }]);
    expect(mergePendingTrials([], resolved, () => "unwanted-trial")).toEqual([]);
    expect(rows[0].playerId).toBeNull();
    expect(applyRosterParticipantCorrections(rows, [{ rawName: "试训甲", playerId: "deleted" }], [])).toEqual(rows);
  });
  it("retains corrections for every existing formal player independently of the roster", () => {
    expect(retainKnownPlayerCorrections([{ rawName: "小张", playerId: "p1" }, { rawName: "小李", playerId: "deleted" }], [{ id: "p1" }]))
      .toEqual([{ rawName: "小张", playerId: "p1" }]);
  });
  it("converts all roles of one trial while preserving source text, teams and the original snapshot", () => {
    const trial = { playerId: null, trialPlayerId: "t1", rawName: "试训甲", confidence: 1 };
    const formal = { playerId: "p2", rawName: "乙", confidence: 1 };
    const parsed = internalParseResultSchema.parse({ matchType: "internal", games: [{ sectionNo: 1, teamA: "blue", teamB: "white", scoreA: 2, scoreB: 1, rawText: "原始文本", events: [
      { type: "goal", team: "blue", scorer: trial, assist: formal, rawText: "甲进球" },
      { type: "goal", team: "blue", scorer: formal, assist: { ...trial, rawName: "试训甲昵称" }, rawText: "甲助攻" },
      { type: "own_goal", team: "white", scorer: trial, rawText: "甲乌龙" }
    ] }] });
    const result = resolveTrialReferences(parsed, "t1", { id: "p1", name: "甲" });
    expect(result.rawNames).toEqual(["试训甲", "试训甲昵称"]);
    expect(result.parsed.games[0].events[0].scorer).toMatchObject({ playerId: "p1", trialPlayerId: null, rawName: "试训甲" });
    expect(result.parsed.games[0].events[1].assist?.playerId).toBe("p1");
    expect(result.parsed.games[0].events[2]).toMatchObject({ type: "own_goal", team: "white", rawText: "甲乌龙", scorer: { playerId: "p1" } });
    expect(parsed.games[0].events[0].scorer.playerId).toBeNull();
  });
  it("flags known formal names and aliases instead of silently creating a second trial identity", () => {
    const players = [{ id: "p1", name: "张三", aliases: [{ alias: "小张" }] }];
    expect(formalNameConflict(" 张三 ", players)?.id).toBe("p1");
    expect(formalNameConflict("小张", players)?.id).toBe("p1");
    expect(formalNameConflict("张三试训", players)).toBeUndefined();
  });
  it("retains unmatched and uncertain roster names for confirmation without resetting confirmed trials", () => {
    const existing = [{ id: "t1", name: "小周", confirmed: true }];
    const rows = [
      { rawName: "小周", playerId: null, needsReview: true },
      { rawName: "小李", playerId: "candidate", needsReview: true },
      { rawName: "小李", playerId: null, needsReview: true },
      { rawName: "正式", playerId: "p1", needsReview: false }
    ];
    expect(mergePendingTrials(existing, rows, () => "t2")).toEqual([
      ...existing, { id: "t2", name: "小李", confirmed: false }
    ]);
  });

  it("lists each event's sections, including repeated goals, with no season aggregates", () => {
    const trial = { playerId: null, trialPlayerId: "t1", rawName: "小周" };
    const formal = { playerId: "p1", rawName: "张三" };
    expect(summarizeTrialEvents("t1", [
      { sectionNo: 2, events: [{ type: "goal", scorer: trial, assist: formal, count: 2 }] },
      { sectionNo: 1, events: [{ type: "goal", scorer: formal, assist: trial, count: 1 }] },
      { sectionNo: 3, events: [{ type: "own_goal", scorer: trial, assist: null, count: 1 }] }
    ])).toEqual({ goals: "第 2 节 ×2", assists: "第 1 节", ownGoals: "第 3 节" });
    expect(summarizeTrialEvents("unused", [])).toEqual({ goals: "—", assists: "—", ownGoals: "—" });
  });

  it("corrects a trial to a formal identity without leaving a conflicting trial id", () => {
    expect(replaceTrialParticipant({ playerId: null, trialPlayerId: "t1", rawName: "小张", confidence: 0.5 },
      "t1", { id: "p1", name: "张三" })).toEqual({
      playerId: "p1", trialPlayerId: null, rawName: "小张", matchedName: "张三", confidence: 1, candidates: []
    });
    const unrelated = { playerId: "p2", rawName: "李四" };
    expect(replaceTrialParticipant(unrelated, "t1", { id: "p1", name: "张三" })).toBe(unrelated);
  });
});
