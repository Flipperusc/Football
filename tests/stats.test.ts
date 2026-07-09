import { describe, expect, it } from "vitest";
import {
  allocatePlayerMatchdayPoints,
  calculateSeasonPlayerStats,
  calculateSectionPoints,
  calculateTeamResults
} from "@/lib/stats/calculate";

describe("football statistics", () => {
  it("calculates section win draw loss points", () => {
    expect(
      calculateSectionPoints({
        matchDayId: "m1",
        sectionNo: 1,
        teamA: "WHITE",
        teamB: "BLUE",
        scoreA: 2,
        scoreB: 1
      })
    ).toEqual({ WHITE: 3, BLUE: 0 });

    expect(
      calculateSectionPoints({
        matchDayId: "m1",
        sectionNo: 2,
        teamA: "WHITE",
        teamB: "RED",
        scoreA: 0,
        scoreB: 0
      })
    ).toEqual({ WHITE: 1, RED: 1 });
  });

  it("calculates six-section internal team rankings and season points", () => {
    const results = calculateTeamResults([
      { matchDayId: "m1", sectionNo: 1, teamA: "WHITE", teamB: "BLUE", scoreA: 1, scoreB: 0 },
      { matchDayId: "m1", sectionNo: 2, teamA: "WHITE", teamB: "RED", scoreA: 0, scoreB: 0 },
      { matchDayId: "m1", sectionNo: 3, teamA: "RED", teamB: "BLUE", scoreA: 2, scoreB: 1 },
      { matchDayId: "m1", sectionNo: 4, teamA: "WHITE", teamB: "BLUE", scoreA: 0, scoreB: 1 },
      { matchDayId: "m1", sectionNo: 5, teamA: "WHITE", teamB: "RED", scoreA: 1, scoreB: 0 },
      { matchDayId: "m1", sectionNo: 6, teamA: "RED", teamB: "BLUE", scoreA: 0, scoreB: 0 }
    ]);

    expect(results.map((result) => result.teamColor)).toEqual(["WHITE", "RED", "BLUE"]);
    expect(results.map((result) => result.seasonPointsAwarded)).toEqual([3, 2, 1]);
    expect(results[0].matchPoints).toBe(7);
  });

  it("allocates team points plus bonus points to assigned players", () => {
    const points = allocatePlayerMatchdayPoints({
      teamResults: [
        {
          teamColor: "WHITE",
          matchPoints: 7,
          goalsFor: 3,
          goalsAgainst: 1,
          goalDifference: 2,
          rank: 1,
          seasonPointsAwarded: 3,
          needsManualReview: false
        },
        {
          teamColor: "RED",
          matchPoints: 4,
          goalsFor: 2,
          goalsAgainst: 2,
          goalDifference: 0,
          rank: 2,
          seasonPointsAwarded: 2,
          needsManualReview: false
        }
      ],
      assignments: [
        { matchDayId: "m1", teamColor: "WHITE", playerId: "p1" },
        { matchDayId: "m1", teamColor: "RED", playerId: "p2" }
      ],
      bonusPoints: [{ playerId: "p2", points: 1 }]
    });

    expect(points.find((point) => point.playerId === "p1")?.totalPoints).toBe(3);
    expect(points.find((point) => point.playerId === "p2")?.totalPoints).toBe(3);
  });

  it("calculates player goals, assists, attendance, and averages", () => {
    const stats = calculateSeasonPlayerStats({
      players: [
        { id: "p1", name: "欧巴" },
        { id: "p2", name: "雪子" }
      ],
      matchDays: [
        { id: "m1", seasonId: "s1", type: "INTERNAL" },
        { id: "m2", seasonId: "s1", type: "EXTERNAL" }
      ],
      assignments: [
        { matchDayId: "m1", teamColor: "WHITE", playerId: "p1" },
        { matchDayId: "m1", teamColor: "WHITE", playerId: "p2" },
        { matchDayId: "m2", teamColor: "EXTERNAL", playerId: "p1" }
      ],
      goalEvents: [
        {
          matchDayId: "m1",
          matchType: "INTERNAL",
          teamColor: "WHITE",
          scorerId: "p2",
          assistPlayerId: "p1",
          count: 2
        },
        {
          matchDayId: "m2",
          matchType: "EXTERNAL",
          teamColor: "EXTERNAL",
          scorerId: "p1",
          assistPlayerId: null,
          count: 1
        }
      ],
      playerPoints: [
        { matchDayId: "m1", playerId: "p1", basePoints: 3, bonusPoints: 0, totalPoints: 3 },
        { matchDayId: "m1", playerId: "p2", basePoints: 3, bonusPoints: 0, totalPoints: 3 }
      ],
      awards: [
        { matchDayId: "m1", name: "最佳后卫", playerId: "p1", points: 1 }
      ]
    });

    expect(stats.find((item) => item.playerId === "p1")).toMatchObject({
      internalAssists: 2,
      externalGoals: 1,
      bestDefenderAwards: 1,
      totalAppearances: 2,
      goalsPerAppearance: 0.5,
      pointsPerInternalAppearance: 3
    });
  });
});
