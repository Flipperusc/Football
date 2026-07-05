import type { PrismaClient } from "@prisma/client";
import { parseResultSchema, type ParseResult } from "@/lib/ai/schemas";
import { calculateTeamResults, allocatePlayerMatchdayPoints } from "@/lib/stats/calculate";
import type {
  BonusPointInput,
  InternalGameInput,
  TeamAssignmentInput,
  TeamColor
} from "@/lib/stats/types";

type ConfirmInput = {
  matchDayId: string;
  parsedJson: unknown;
  teamAssignments?: {
    teamColor: TeamColor;
    playerId: string;
    role?: "PLAYER" | "GOALKEEPER";
    isCaptain?: boolean;
  }[];
  saveAliases?: {
    playerId: string;
    rawName: string;
    aliasType: "NICKNAME" | "TYPO" | "SHORT_NAME" | "MANUAL";
  }[];
};

const colorToDb = {
  red: "RED",
  blue: "BLUE",
  white: "WHITE",
  external: "EXTERNAL"
} as const;

function collectMissingPlayers(parsed: ParseResult) {
  const events = parsed.matchType === "internal" ? parsed.games.flatMap((game) => game.events) : parsed.events;
  return events
    .filter((event) => !event.scorer.playerId || (event.assist && !event.assist.playerId))
    .map((event) => event.rawText);
}

export async function confirmMatchDay(prisma: PrismaClient, input: ConfirmInput) {
  const parsed = parseResultSchema.parse(input.parsedJson);
  const missingPlayers = collectMissingPlayers(parsed);
  if (missingPlayers.length > 0) {
    throw new Error(`仍有未匹配球员，不能确认入库：${missingPlayers.join("、")}`);
  }

  return prisma.$transaction(async (tx) => {
    const matchDay = await tx.matchDay.findUnique({
      where: { id: input.matchDayId },
      include: { assignments: true }
    });
    if (!matchDay) throw new Error("比赛日不存在");

    const activeAssignments = input.teamAssignments
      ? input.teamAssignments.map((assignment) => ({
          matchDayId: input.matchDayId,
          teamColor: assignment.teamColor,
          playerId: assignment.playerId
        }))
      : matchDay.assignments.map((assignment) => ({
          matchDayId: assignment.matchDayId,
          teamColor: assignment.teamColor,
          playerId: assignment.playerId
        }));

    if (
      parsed.matchType === "internal" &&
      activeAssignments.filter((assignment) => assignment.teamColor !== "EXTERNAL").length === 0
    ) {
      throw new Error(
        "Internal match has no team assignments, so player rank points cannot be allocated. Please fill RED/BLUE/WHITE players before confirming."
      );
    }

    await tx.goalEvent.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.playerMatchdayPoint.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.teamMatchdayResult.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.award.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.internalGame.deleteMany({ where: { matchDayId: input.matchDayId } });

    if (input.teamAssignments) {
      await tx.teamAssignment.deleteMany({ where: { matchDayId: input.matchDayId } });
      if (input.teamAssignments.length > 0) {
        await tx.teamAssignment.createMany({
          data: input.teamAssignments.map((assignment) => ({
            matchDayId: input.matchDayId,
            teamColor: assignment.teamColor,
            playerId: assignment.playerId,
            role: assignment.role ?? "PLAYER",
            isCaptain: assignment.isCaptain ?? false
          })),
          skipDuplicates: true
        });
      }
    }

    if (input.saveAliases?.length) {
      await tx.playerAlias.createMany({
        data: input.saveAliases.map((alias) => ({
          playerId: alias.playerId,
          alias: alias.rawName,
          aliasType: alias.aliasType
        })),
        skipDuplicates: true
      });
    }

    if (parsed.matchType === "internal") {
      const gameRows = await Promise.all(
        parsed.games.map((game) =>
          tx.internalGame.create({
            data: {
              matchDayId: input.matchDayId,
              sectionNo: game.sectionNo,
              teamA: colorToDb[game.teamA],
              teamB: colorToDb[game.teamB],
              scoreA: game.scoreA,
              scoreB: game.scoreB,
              rawText: game.rawText
            }
          })
        )
      );
      const gameIdBySection = new Map(gameRows.map((game) => [game.sectionNo, game.id]));

      for (const game of parsed.games) {
        for (const event of game.events) {
          if (!event.scorer.playerId) continue;
          await tx.goalEvent.create({
            data: {
              matchDayId: input.matchDayId,
              internalGameId: gameIdBySection.get(game.sectionNo),
              matchType: "INTERNAL",
              teamColor: event.team ? colorToDb[event.team] : null,
              scorerId: event.scorer.playerId,
              assistPlayerId: event.assist?.playerId ?? null,
              count: event.count,
              rawText: event.rawText,
              needsReview: event.needsReview
            }
          });
        }
      }

      for (const award of parsed.awards) {
        for (const player of award.players) {
          await tx.award.create({
            data: {
              matchDayId: input.matchDayId,
              name: award.name,
              playerId: player.playerId,
              points: award.points,
              rawText: award.rawText
            }
          });
        }
      }

      const typedGames: InternalGameInput[] = parsed.games.map((game) => ({
        matchDayId: input.matchDayId,
        sectionNo: game.sectionNo,
        teamA: colorToDb[game.teamA],
        teamB: colorToDb[game.teamB],
        scoreA: game.scoreA,
        scoreB: game.scoreB
      }));
      const teamResults = calculateTeamResults(typedGames);
      await tx.teamMatchdayResult.createMany({
        data: teamResults.map((result) => ({
          matchDayId: input.matchDayId,
          teamColor: result.teamColor,
          matchPoints: result.matchPoints,
          goalsFor: result.goalsFor,
          goalsAgainst: result.goalsAgainst,
          goalDifference: result.goalDifference,
          rank: result.rank,
          seasonPointsAwarded: result.seasonPointsAwarded,
          needsManualReview: result.needsManualReview
        }))
      });

      const textBonusPoints: BonusPointInput[] = parsed.bonusPoints
        .filter((bonus) => bonus.player.playerId)
        .map((bonus) => ({
          playerId: bonus.player.playerId!,
          points: bonus.points,
          reason: bonus.reason
        }));
      const awardBonusPoints: BonusPointInput[] = parsed.awards.flatMap((award) =>
        award.points === 0
          ? []
          : award.players
              .filter((player) => player.playerId)
              .map((player) => ({
                playerId: player.playerId!,
                points: award.points,
                reason: award.name
              }))
      );
      const bonusPoints = [...textBonusPoints, ...awardBonusPoints];
      const playerPoints = allocatePlayerMatchdayPoints({
        teamResults,
        assignments: activeAssignments as TeamAssignmentInput[],
        bonusPoints
      });
      if (playerPoints.length > 0) {
        await tx.playerMatchdayPoint.createMany({
          data: playerPoints.map((point) => ({
            matchDayId: input.matchDayId,
            playerId: point.playerId,
            basePoints: point.basePoints,
            bonusPoints: point.bonusPoints,
            totalPoints: point.totalPoints,
            reason: bonusPoints.find((bonus) => bonus.playerId === point.playerId)?.reason
          })),
          skipDuplicates: true
        });
      }
    } else {
      for (const event of parsed.events) {
        if (!event.scorer.playerId) continue;
        await tx.goalEvent.create({
          data: {
            matchDayId: input.matchDayId,
            matchType: "EXTERNAL",
            teamColor: "EXTERNAL",
            scorerId: event.scorer.playerId,
            assistPlayerId: event.assist?.playerId ?? null,
            count: event.count,
            rawText: event.rawText,
            needsReview: event.needsReview
          }
        });
      }

      for (const award of parsed.awards) {
        for (const player of award.players) {
          await tx.award.create({
            data: {
              matchDayId: input.matchDayId,
              name: award.name,
              playerId: player.playerId,
              points: award.points,
              rawText: award.rawText
            }
          });
        }
      }
    }

    return tx.matchDay.update({
      where: { id: input.matchDayId },
      data: {
        parseStatus: "CONFIRMED",
        confirmedAt: new Date()
      },
      include: {
        assignments: { include: { player: true } },
        internalGames: true,
        goalEvents: true,
        teamResults: true,
        playerPoints: true,
        awards: true
      }
    });
  });
}
