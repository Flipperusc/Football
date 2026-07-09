import { prisma } from "@/lib/prisma";
import { calculateSeasonPlayerStats, rankPlayers } from "@/lib/stats/calculate";
import { isBestDefenderAwardName } from "@/lib/stats/awards";
import type {
  AwardInput,
  GoalEventInput,
  MatchDayInput,
  PlayerInput,
  PlayerPointInput,
  PlayerSeasonStats,
  TeamAssignmentInput
} from "@/lib/stats/types";

type AdjustmentMetric =
  | "INTERNAL_GOALS"
  | "INTERNAL_ASSISTS"
  | "INTERNAL_APPEARANCES"
  | "INTERNAL_SEASON_POINTS"
  | "EXTERNAL_GOALS"
  | "EXTERNAL_ASSISTS"
  | "EXTERNAL_APPEARANCES";

type AdjustmentOperation = "SET" | "ADJUST";

const metricFieldMap = {
  INTERNAL_GOALS: "internalGoals",
  INTERNAL_ASSISTS: "internalAssists",
  INTERNAL_APPEARANCES: "internalAppearances",
  INTERNAL_SEASON_POINTS: "internalSeasonPoints",
  EXTERNAL_GOALS: "externalGoals",
  EXTERNAL_ASSISTS: "externalAssists",
  EXTERNAL_APPEARANCES: "externalAppearances"
} satisfies Record<AdjustmentMetric, keyof PlayerSeasonStats>;

function safeRate(numerator: number, denominator: number) {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(2));
}

function applyStatAdjustments(
  playerStats: PlayerSeasonStats[],
  adjustments: {
    playerId: string;
    metric: AdjustmentMetric;
    operation: AdjustmentOperation;
    value: number;
  }[]
) {
  const rowsByPlayer = new Map(playerStats.map((row) => [row.playerId, { ...row }]));

  for (const adjustment of adjustments) {
    const row = rowsByPlayer.get(adjustment.playerId);
    if (!row) continue;
    const field = metricFieldMap[adjustment.metric];
    const current = Number(row[field] ?? 0);
    (row[field] as number) =
      adjustment.operation === "SET" ? adjustment.value : current + adjustment.value;
  }

  return Array.from(rowsByPlayer.values()).map((row) => {
    const totalGoals = row.internalGoals + row.externalGoals;
    const totalAssists = row.internalAssists + row.externalAssists;
    const totalAppearances = row.internalAppearances + row.externalAppearances;

    return {
      ...row,
      totalGoals,
      totalAssists,
      totalAppearances,
      goalsPerAppearance: safeRate(totalGoals, totalAppearances),
      assistsPerAppearance: safeRate(totalAssists, totalAppearances),
      pointsPerInternalAppearance: safeRate(row.internalSeasonPoints, row.internalAppearances)
    };
  });
}

export async function loadSeasonStats(seasonId: string) {
  const [season, players, matchDays, statAdjustments] = await Promise.all([
    prisma.season.findUnique({ where: { id: seasonId } }),
    prisma.player.findMany({ orderBy: { name: "asc" } }),
    prisma.matchDay.findMany({
      where: { seasonId, parseStatus: "CONFIRMED" },
      include: {
        assignments: true,
        goalEvents: true,
        playerPoints: true,
        teamResults: true,
        awards: true
      },
      orderBy: { date: "asc" }
    }),
    prisma.playerStatAdjustment.findMany({
      where: { seasonId },
      orderBy: { createdAt: "asc" }
    })
  ]);

  if (!season) return null;

  const typedPlayers: PlayerInput[] = players.map((player) => ({
    id: player.id,
    name: player.name
  }));
  const avatarUrlByPlayerId = new Map(players.map((player) => [player.id, player.avatarUrl]));
  const typedMatchDays: MatchDayInput[] = matchDays.map((matchDay) => ({
    id: matchDay.id,
    seasonId: matchDay.seasonId,
    type: matchDay.type
  }));
  const assignments: TeamAssignmentInput[] = matchDays.flatMap((matchDay) =>
    matchDay.assignments.map((assignment) => ({
      matchDayId: assignment.matchDayId,
      teamColor: assignment.teamColor,
      playerId: assignment.playerId
    }))
  );
  const goalEvents: GoalEventInput[] = matchDays.flatMap((matchDay) =>
    matchDay.goalEvents.map((event) => ({
      matchDayId: event.matchDayId,
      matchType: event.matchType,
      teamColor: event.teamColor,
      scorerId: event.scorerId,
      assistPlayerId: event.assistPlayerId,
      count: event.count
    }))
  );
  const awards: AwardInput[] = matchDays.flatMap((matchDay) =>
    matchDay.awards.map((award) => ({
      matchDayId: award.matchDayId,
      name: award.name,
      playerId: award.playerId,
      points: award.points
    }))
  );
  const bestDefenderPointsByPlayerMatchday = new Map<string, number>();
  for (const award of awards) {
    if (!award.playerId || !isBestDefenderAwardName(award.name) || award.points === 0) continue;
    const key = `${award.matchDayId}:${award.playerId}`;
    bestDefenderPointsByPlayerMatchday.set(
      key,
      (bestDefenderPointsByPlayerMatchday.get(key) ?? 0) + award.points
    );
  }
  const playerPoints: PlayerPointInput[] = matchDays.flatMap((matchDay) =>
    matchDay.playerPoints.map((point) => {
      const excludedPoints = Math.min(
        bestDefenderPointsByPlayerMatchday.get(`${point.matchDayId}:${point.playerId}`) ?? 0,
        Math.max(point.bonusPoints, 0)
      );

      return {
        matchDayId: point.matchDayId,
        playerId: point.playerId,
        basePoints: point.basePoints,
        bonusPoints: point.bonusPoints - excludedPoints,
        totalPoints: point.totalPoints - excludedPoints
      };
    })
  );

  const playerStats = applyStatAdjustments(
    calculateSeasonPlayerStats({
      players: typedPlayers,
      matchDays: typedMatchDays,
      assignments,
      goalEvents,
      playerPoints,
      awards
    }),
    statAdjustments.map((adjustment) => ({
      playerId: adjustment.playerId,
      metric: adjustment.metric,
      operation: adjustment.operation,
      value: adjustment.value
    }))
  ).map((row) => ({
    ...row,
    avatarUrl: avatarUrlByPlayerId.get(row.playerId) ?? null
  }));

  return {
    season,
    matchDays,
    playerStats,
    rankings: {
      goals: rankPlayers(playerStats, "totalGoals"),
      assists: rankPlayers(playerStats, "totalAssists"),
      appearances: rankPlayers(playerStats, "totalAppearances"),
      internalPoints: rankPlayers(playerStats, "internalSeasonPoints"),
      bestDefenders: rankPlayers(playerStats, "bestDefenderAwards"),
      goalsPerAppearance: rankPlayers(playerStats, "goalsPerAppearance"),
      pointsPerInternalAppearance: rankPlayers(playerStats, "pointsPerInternalAppearance")
    }
  };
}
