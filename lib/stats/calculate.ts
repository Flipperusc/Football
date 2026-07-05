import type {
  BonusPointInput,
  GoalEventInput,
  InternalGameInput,
  MatchDayInput,
  PlayerInput,
  PlayerPointInput,
  PlayerSeasonStats,
  TeamAssignmentInput,
  TeamColor,
  TeamResult
} from "./types";

const internalTeams: TeamColor[] = ["RED", "BLUE", "WHITE"];
const seasonPointsByRank: Record<number, number> = {
  1: 3,
  2: 2,
  3: 1
};

function emptyTeamResult(teamColor: TeamColor): TeamResult {
  return {
    teamColor,
    matchPoints: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    rank: null,
    seasonPointsAwarded: 0,
    needsManualReview: false
  };
}

export function calculateSectionPoints(game: InternalGameInput) {
  if (game.scoreA > game.scoreB) {
    return { [game.teamA]: 3, [game.teamB]: 0 } as Partial<Record<TeamColor, number>>;
  }
  if (game.scoreA < game.scoreB) {
    return { [game.teamA]: 0, [game.teamB]: 3 } as Partial<Record<TeamColor, number>>;
  }
  return { [game.teamA]: 1, [game.teamB]: 1 } as Partial<Record<TeamColor, number>>;
}

function headToHead(games: InternalGameInput[], teamA: TeamColor, teamB: TeamColor) {
  return games
    .filter(
      (game) =>
        (game.teamA === teamA && game.teamB === teamB) ||
        (game.teamA === teamB && game.teamB === teamA)
    )
    .reduce(
      (acc, game) => {
        const points = calculateSectionPoints(game);
        acc.pointsA += points[teamA] ?? 0;
        acc.pointsB += points[teamB] ?? 0;
        if (game.teamA === teamA) {
          acc.goalDiffA += game.scoreA - game.scoreB;
          acc.goalDiffB += game.scoreB - game.scoreA;
        } else {
          acc.goalDiffA += game.scoreB - game.scoreA;
          acc.goalDiffB += game.scoreA - game.scoreB;
        }
        return acc;
      },
      { pointsA: 0, pointsB: 0, goalDiffA: 0, goalDiffB: 0 }
    );
}

function compareTeams(games: InternalGameInput[], a: TeamResult, b: TeamResult) {
  if (a.matchPoints !== b.matchPoints) return b.matchPoints - a.matchPoints;
  if (a.goalDifference !== b.goalDifference) return b.goalDifference - a.goalDifference;

  const direct = headToHead(games, a.teamColor, b.teamColor);
  if (direct.pointsA !== direct.pointsB) return direct.pointsB - direct.pointsA;
  if (direct.goalDiffA !== direct.goalDiffB) return direct.goalDiffB - direct.goalDiffA;
  return 0;
}

export function calculateTeamResults(games: InternalGameInput[]): TeamResult[] {
  const results = new Map<TeamColor, TeamResult>(
    internalTeams.map((team) => [team, emptyTeamResult(team)])
  );

  for (const game of games) {
    const teamA = results.get(game.teamA);
    const teamB = results.get(game.teamB);
    if (!teamA || !teamB) continue;

    const points = calculateSectionPoints(game);
    teamA.matchPoints += points[game.teamA] ?? 0;
    teamB.matchPoints += points[game.teamB] ?? 0;
    teamA.goalsFor += game.scoreA;
    teamA.goalsAgainst += game.scoreB;
    teamB.goalsFor += game.scoreB;
    teamB.goalsAgainst += game.scoreA;
    teamA.goalDifference = teamA.goalsFor - teamA.goalsAgainst;
    teamB.goalDifference = teamB.goalsFor - teamB.goalsAgainst;
  }

  const sorted = Array.from(results.values()).sort((a, b) => compareTeams(games, a, b));
  const unresolved = new Set<TeamColor>();

  sorted.forEach((result, index) => {
    result.rank = index + 1;
    result.seasonPointsAwarded = seasonPointsByRank[index + 1] ?? 0;
  });

  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (compareTeams(games, sorted[index], sorted[index + 1]) === 0) {
      unresolved.add(sorted[index].teamColor);
      unresolved.add(sorted[index + 1].teamColor);
    }
  }

  return sorted.map((result) => ({
    ...result,
    needsManualReview: unresolved.has(result.teamColor)
  }));
}

export function allocatePlayerMatchdayPoints(input: {
  teamResults: TeamResult[];
  assignments: TeamAssignmentInput[];
  bonusPoints?: BonusPointInput[];
}): PlayerPointInput[] {
  const pointsByTeam = new Map(
    input.teamResults.map((result) => [result.teamColor, result.seasonPointsAwarded])
  );
  const pointsByPlayer = new Map<string, PlayerPointInput>();

  for (const assignment of input.assignments.filter((entry) => entry.teamColor !== "EXTERNAL")) {
    const basePoints = pointsByTeam.get(assignment.teamColor) ?? 0;
    pointsByPlayer.set(assignment.playerId, {
      matchDayId: assignment.matchDayId,
      playerId: assignment.playerId,
      basePoints,
      bonusPoints: 0,
      totalPoints: basePoints
    });
  }

  for (const bonus of input.bonusPoints ?? []) {
    const current =
      pointsByPlayer.get(bonus.playerId) ??
      ({
        matchDayId: input.assignments[0]?.matchDayId ?? "",
        playerId: bonus.playerId,
        basePoints: 0,
        bonusPoints: 0,
        totalPoints: 0
      } satisfies PlayerPointInput);
    current.bonusPoints += bonus.points;
    current.totalPoints = current.basePoints + current.bonusPoints;
    pointsByPlayer.set(bonus.playerId, current);
  }

  return Array.from(pointsByPlayer.values());
}

function safeRate(numerator: number, denominator: number) {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(2));
}

export function calculateSeasonPlayerStats(input: {
  players: PlayerInput[];
  matchDays: MatchDayInput[];
  assignments: TeamAssignmentInput[];
  goalEvents: GoalEventInput[];
  playerPoints: PlayerPointInput[];
}): PlayerSeasonStats[] {
  const matchTypeById = new Map(input.matchDays.map((matchDay) => [matchDay.id, matchDay.type]));

  return input.players.map((player) => {
    const internalAppearanceDays = new Set(
      input.assignments
        .filter(
          (assignment) =>
            assignment.playerId === player.id &&
            assignment.teamColor !== "EXTERNAL" &&
            matchTypeById.get(assignment.matchDayId) === "INTERNAL"
        )
        .map((assignment) => assignment.matchDayId)
    );
    const externalAppearanceDays = new Set(
      input.assignments
        .filter(
          (assignment) =>
            assignment.playerId === player.id &&
            assignment.teamColor === "EXTERNAL" &&
            matchTypeById.get(assignment.matchDayId) === "EXTERNAL"
        )
        .map((assignment) => assignment.matchDayId)
    );

    const internalEvents = input.goalEvents.filter(
      (event) => event.matchType === "INTERNAL" && event.scorerId === player.id
    );
    const externalEvents = input.goalEvents.filter(
      (event) => event.matchType === "EXTERNAL" && event.scorerId === player.id
    );
    const internalAssistEvents = input.goalEvents.filter(
      (event) => event.matchType === "INTERNAL" && event.assistPlayerId === player.id
    );
    const externalAssistEvents = input.goalEvents.filter(
      (event) => event.matchType === "EXTERNAL" && event.assistPlayerId === player.id
    );

    const internalGoals = internalEvents.reduce((sum, event) => sum + event.count, 0);
    const externalGoals = externalEvents.reduce((sum, event) => sum + event.count, 0);
    const internalAssists = internalAssistEvents.reduce((sum, event) => sum + event.count, 0);
    const externalAssists = externalAssistEvents.reduce((sum, event) => sum + event.count, 0);
    const internalSeasonPoints = input.playerPoints
      .filter((point) => point.playerId === player.id)
      .reduce((sum, point) => sum + point.totalPoints, 0);
    const internalAppearances = internalAppearanceDays.size;
    const externalAppearances = externalAppearanceDays.size;
    const totalGoals = internalGoals + externalGoals;
    const totalAssists = internalAssists + externalAssists;
    const totalAppearances = internalAppearances + externalAppearances;

    return {
      playerId: player.id,
      name: player.name,
      internalGoals,
      internalAssists,
      internalAppearances,
      internalSeasonPoints,
      externalGoals,
      externalAssists,
      externalAppearances,
      totalGoals,
      totalAssists,
      totalAppearances,
      goalsPerAppearance: safeRate(totalGoals, totalAppearances),
      assistsPerAppearance: safeRate(totalAssists, totalAppearances),
      pointsPerInternalAppearance: safeRate(internalSeasonPoints, internalAppearances)
    };
  });
}

export function rankPlayers(stats: PlayerSeasonStats[], key: keyof PlayerSeasonStats) {
  return [...stats].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (typeof left === "number" && typeof right === "number") {
      return right - left || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
}
