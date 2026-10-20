import { describe, expect, it } from "vitest";
import { internalParseResultSchema, parseResultSchema } from "@/lib/ai/schemas";
import { inspectInternalEvents } from "@/lib/match-events";

const roster = [
  { playerId: "red", teamColor: "RED" as const },
  { playerId: "red-assist", teamColor: "RED" as const },
  { playerId: "white", teamColor: "WHITE" as const },
  { playerId: "blue", teamColor: "BLUE" as const }
];
const player = (id: string) => ({ playerId: id, rawName: id, confidence: 1, candidates: [] });
function match(overrides: Record<string, unknown> = {}, gameOverrides: Record<string, unknown> = {}) {
  return internalParseResultSchema.parse({
    matchType: "internal",
    games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 2, rawText: "",
      events: [{ type: "goal", team: "blue", scorer: player("blue"), assist: null, count: 1, rawText: "", ...overrides }],
      ...gameOverrides }]
  });
}

describe("internal event attribution", () => {
  it("needs no exception for an ordinary roster goal", () => {
    const result = inspectInternalEvents(match(), roster);
    expect(result.issues).toEqual([]);
    expect(result.exceptions).toEqual([]);
    expect(result.resolutions[0]).toMatchObject({ teamColor: "BLUE", scorerRosterTeam: "BLUE" });
  });

  it("identifies both guest participants without changing their roster", () => {
    const result = inspectInternalEvents(match({ scorer: player("red"), assist: player("red-assist") }), roster);
    expect(result.issues).toEqual([]);
    expect(result.exceptions[0]).toMatchObject({ reasons: ["SCORER_GUEST", "ASSIST_GUEST"], team: "blue", representedTeam: "blue" });
    expect(result.resolutions[0]).toMatchObject({ teamColor: "BLUE", scorerRosterTeam: "RED", assistRosterTeam: "RED" });
    expect(roster[0].teamColor).toBe("RED");
  });

  it("also detects a guest whose original team is playing this section", () => {
    const result = inspectInternalEvents(match({ scorer: player("white") }), roster);
    expect(result.exceptions[0].reasons).toEqual(["SCORER_GUEST"]);
  });

  it("attributes an own goal to the opponent without marking its actor as a guest", () => {
    const result = inspectInternalEvents(match({ type: "own_goal", scorer: player("white") }), roster);
    expect(result.issues).toEqual([]);
    expect(result.exceptions[0]).toMatchObject({ reasons: ["OWN_GOAL"], team: "blue", representedTeam: "white" });
  });

  it("supports a guest scoring an own goal", () => {
    const result = inspectInternalEvents(match({ type: "own_goal", scorer: player("red") }), roster);
    expect(result.exceptions[0]).toMatchObject({ reasons: ["OWN_GOAL", "SCORER_GUEST"], representedTeam: "white" });
  });

  it("asks for the beneficiary when a third-team player has no attribution", () => {
    const result = inspectInternalEvents(match({ team: undefined, scorer: player("red") }), roster);
    expect(result.issues).toEqual([]);
    expect(result.exceptions[0].reasons).toContain("TEAM_REQUIRED");
    expect(result.resolutions).toHaveLength(0);
  });

  it("preserves an explicitly unresolved substitution even when the original team is playing", () => {
    const result = inspectInternalEvents(match({ team: undefined, scorer: player("white"), needsTeamSelection: true }), roster);
    expect(result.exceptions[0].reasons).toContain("TEAM_REQUIRED");
    expect(result.resolutions).toHaveLength(0);
  });

  it("does not turn an illegal explicit beneficiary into an overridable exception", () => {
    const result = inspectInternalEvents(match({ team: "red" }), roster);
    expect(result.issues.join()).toContain("得分队");
  });

  it("rejects assists on own goals and unknown or unassigned players", () => {
    expect(inspectInternalEvents(match({ type: "own_goal", scorer: player("white"), assist: player("blue") }), roster).issues.join()).toContain("乌龙球不计助攻");
    expect(inspectInternalEvents(match({ scorer: player("unknown") }), roster).issues.join()).toContain("分队");
    expect(inspectInternalEvents(match({ scorer: { ...player(""), playerId: null } }), roster).issues.join()).toContain("未匹配");
  });

  it("checks goals against the beneficiary score, while allowing incomplete goal details", () => {
    expect(inspectInternalEvents(match({ type: "own_goal", scorer: player("white"), count: 2 }), roster).issues).toEqual([]);
    expect(inspectInternalEvents(match({ count: 3 }), roster).issues.join()).toContain("比分");
    expect(inspectInternalEvents(match({ count: 1 }), roster).issues).toEqual([]);
  });

  it("rejects duplicate assignments and duplicate or self-playing sections", () => {
    expect(inspectInternalEvents(match(), [...roster, roster[0]]).issues.join()).toContain("重复分队");
    expect(inspectInternalEvents(match({}, { teamA: "blue" }), roster).issues.join()).toContain("不同");
    const parsed = match();
    parsed.games.push(parsed.games[0]);
    expect(inspectInternalEvents(parsed, roster).issues.join()).toContain("重复");
  });

  it("does not expand external matches to own goals", () => {
    expect(parseResultSchema.safeParse({ matchType: "external", events: [match({ type: "own_goal" }).games[0].events[0]] }).success).toBe(false);
  });
});
