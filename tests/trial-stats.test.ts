import { describe, expect, it } from "vitest";
import { allocatePlayerMatchdayPoints, calculateSeasonPlayerStats, calculateTeamResults } from "@/lib/stats/calculate";
import { buildPlayerActivities } from "@/lib/stats/player-activity";

describe("trial and eligibility statistics", () => {
  const teamResults = calculateTeamResults([{ matchDayId: "m", sectionNo: 1, teamA: "BLUE", teamB: "RED", scoreA: 1, scoreB: 0 }]);
  it("ignores retired eligibility flags and awards full points", () => {
    const allocate = (pointsEligible: boolean) => allocatePlayerMatchdayPoints({teamResults, assignments: [{ matchDayId: "m", teamColor: "BLUE", playerId: "p", pointsEligible }], bonusPoints: [{playerId: "p", points: 1}, {playerId: "p", points: 1}]});
    expect(allocate(false)[0]).toMatchObject({basePoints: 3, bonusPoints: 2, totalPoints: 5});
    expect(allocate(true)[0]).toMatchObject({basePoints: 3, bonusPoints: 2, totalPoints: 5});
    expect(allocate(true)[0].totalPoints).toBe(5);
  });
  it("counts formal roles in mixed trial events, keeps own goals separate, and preserves attendance and awards when excluded", () => {
    const rows = calculateSeasonPlayerStats({ players: [{id: "p", name: "张三"}], matchDays: [{id: "m", seasonId: "s", type: "INTERNAL"}], assignments: [{matchDayId: "m", playerId: "p", teamColor: "BLUE", pointsEligible: false}], goalEvents: [
      { matchDayId: "m", matchType: "INTERNAL", scorerId: null, assistPlayerId: "p", count: 1 },
      { matchDayId: "m", matchType: "INTERNAL", scorerId: "p", count: 2 },
      { matchDayId: "m", matchType: "INTERNAL", scorerId: "p", kind: "OWN_GOAL", count: 1 },
      { matchDayId: "m", matchType: "INTERNAL", scorerId: null, kind: "OWN_GOAL", count: 3 }
    ], playerPoints: [{matchDayId: "m", playerId: "p", basePoints: 3, bonusPoints: 2, totalPoints: 5}], awards: [{matchDayId: "m", playerId: "p", name: "最佳后卫", points: 1}] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({internalGoals: 2, internalAssists: 1, internalOwnGoals: 1, internalAppearances: 1, internalSeasonPoints: 5, bestDefenderAwards: 1, totalGoals: 2, goalsPerAppearance: 2});
  });
  it("does not emit a fake trial activity but keeps a formal assist", () => {
    const rows = buildPlayerActivities([{id: "m", date: "2026-10-21", type: "INTERNAL", internalGames: [], playerPoints: [], goalEvents: [{id: "trial", scorerId: null, assistPlayerId: "p", count: 1}, {id: "own", scorerId: null, kind: "OWN_GOAL", count: 1}]}], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({playerId: "p", kind: "ASSIST"});
  });
});
