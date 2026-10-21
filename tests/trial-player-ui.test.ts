import { describe, expect, it } from "vitest";
import { mergePendingTrials, summarizeTrialEvents, replaceTrialParticipant, formalNameConflict, retainRosterCorrections } from "@/lib/trial-players";

describe("trial participant editing", () => {
  it("drops a correction after its formal player is removed from the roster", () => {
    expect(retainRosterCorrections([{ rawName: "小张", playerId: "p1" }, { rawName: "小李", playerId: "p2" }], [{ playerId: "p2" }]))
      .toEqual([{ rawName: "小李", playerId: "p2" }]);
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
