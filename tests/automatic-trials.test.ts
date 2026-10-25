import { describe, expect, it } from "vitest";
import { assignAutomaticTrials, isTrialLabel } from "@/lib/ai/automatic-trials";
import { localParseMatch } from "@/lib/ai/local-parser";
import { parseRosterWithAi } from "@/lib/ai/roster";
import { vi } from "vitest";

describe("automatic trial identities", () => {
  it("uses an exact formal name before the generic trial-label rule in roster recognition", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    try {
      const result = await parseRosterWithAi({ rawText: "蓝\n试训张三", matchType: "INTERNAL", players: [{ id: "formal", name: "试训张三", aliases: [] }] });
      expect(result.parsed.assignments[0].playerId).toBe("formal");
    } finally { vi.unstubAllEnvs(); }
  });
  it("deduplicates unknown scorers and assistants, while preserving formal/manual identities", () => {
    const parsed = { matchType: "internal", games: [{ events: [
      { scorer: { rawName: "临时球员", playerId: null }, assist: { rawName: "陌生甲", playerId: null } },
      { scorer: { rawName: "临时球员", playerId: null }, assist: { rawName: "试训张三", playerId: "formal" } }
    ] }] };
    let i = 0;
    const trials = assignAutomaticTrials(parsed, [], () => `trial-${++i}`);
    expect(trials).toEqual([{ id: "trial-1", name: "临时球员", confirmed: false }, { id: "trial-2", name: "陌生甲", confirmed: false }]);
    expect(parsed.games[0].events[1].scorer).toHaveProperty("trialPlayerId", "trial-1");
    expect(parsed.games[0].events[1].assist.playerId).toBe("formal");
    expect(assignAutomaticTrials(parsed, trials, () => "unused")).toEqual(trials);
  });
  it("does not treat temporary guest play as a trial label", () => {
    expect(isTrialLabel("张三临时代打")).toBe(false);
    for (const name of ["临时球员", "试训一", "试踢甲"]) expect(isTrialLabel(name)).toBe(true);
  });
  it("retains unknown names in local scorer, assistant and own-goal events", () => {
    const parsed = localParseMatch({ rawText: "第一节白蓝0:3，临时球员替蓝队进球，试训甲助攻陌生乙替蓝队进球，陌生丙乌龙", matchType: "INTERNAL", players: [], teamAssignments: [] });
    let i = 0;
    const trials = assignAutomaticTrials(parsed, [], () => `t${++i}`);
    expect(trials.map((row) => row.name).sort()).toEqual(["临时球员", "试训甲", "陌生乙", "陌生丙"].sort());
    if (parsed.matchType !== "internal") throw new Error("Expected internal match");
    expect(parsed.games[0].events).toHaveLength(3);
  });
  it("keeps a named formal guest player formal", () => {
    const parsed = localParseMatch({ rawText: "第一节白蓝0:1，张三临时代打进球", matchType: "INTERNAL", players: [{ id: "p", name: "张三", aliases: [] }], teamAssignments: [{ playerId: "p", teamColor: "RED" }] });
    expect(assignAutomaticTrials(parsed, [], () => "trial")).toEqual([]);
  });
});
