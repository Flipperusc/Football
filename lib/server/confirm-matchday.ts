import { Prisma, type PrismaClient } from "@prisma/client";
import { parseResultSchema, type ParseResult } from "@/lib/ai/schemas";
import { unusedParticipantCorrections } from "@/lib/ai/participant-corrections";
import { teamAssignmentInputSchema, trialPlayersInputSchema, participantCorrectionsSchema } from "@/lib/validations";
import { assertTrialPlayerScope, replaceTrialPlayers } from "@/lib/server/trial-players";
import type { TrialParticipant } from "@/lib/match-events";
import { getAdminCredentials } from "@/lib/admin-auth";
import { inspectInternalEvents, type EventResolution } from "@/lib/match-events";
import { createEventConfirmation, verifyEventConfirmation, EventConfirmationRequired, MatchDayChanged } from "@/lib/server/event-confirmation";
import { calculateTeamResults, allocatePlayerMatchdayPoints } from "@/lib/stats/calculate";
import { isBestDefenderAwardName } from "@/lib/stats/awards";
import {
  assertPlayerPayloadsAvailable,
  translatePlayerIdentityWriteError,
  type IdentityCandidate
} from "@/lib/server/player-identities";
import type {
  BonusPointInput,
  InternalGameInput,
  TeamAssignmentInput,
  TeamColor
} from "@/lib/stats/types";

type InternalTeamColor = Exclude<TeamColor, "EXTERNAL">;

type ManualTeamRank = {
  teamColor: InternalTeamColor;
  rank: number;
};

type ConfirmInput = {
  matchDayId: string;
  parsedJson: unknown;
  eventConfirmationToken?: string;
  matchDayVersion?: string;
  trialPlayers?: TrialParticipant[];
  teamAssignments?: {
    teamColor: TeamColor;
    playerId: string;
    role?: "PLAYER" | "GOALKEEPER";
    isCaptain?: boolean;
    pointsEligible?: boolean;
  }[];
  manualTeamRanks?: ManualTeamRank[];
  saveAliases?: {
    playerId: string;
    rawName: string;
    aliasType: "NICKNAME" | "TYPO" | "SHORT_NAME" | "MANUAL";
  }[];
};

export class TeamRankingConfirmationRequired extends Error {
  readonly status = 409;
  readonly code = "TEAM_RANKING_CONFIRMATION_REQUIRED";

  constructor(readonly teamResults: ReturnType<typeof calculateTeamResults>) {
    super("三队自动排名仍有并列，请人工确认第 1、2、3 名后再入库");
    this.name = "TeamRankingConfirmationRequired";
  }
}

const colorToDb = {
  red: "RED",
  blue: "BLUE",
  white: "WHITE",
  external: "EXTERNAL"
} as const;

function awardPointsForStorage(name: string, points: number) {
  return isBestDefenderAwardName(name) ? 0 : points;
}

function collectMissingPlayers(parsed: ParseResult) {
  const events = parsed.matchType === "internal" ? parsed.games.flatMap((game) => game.events) : parsed.events;
  return events
    .filter((event) => !(event.scorer.playerId || (parsed.matchType === "internal" && event.scorer.trialPlayerId)) || (event.assist && !(event.assist.playerId || (parsed.matchType === "internal" && event.assist.trialPlayerId))))
    .map((event) => event.rawText);
}

function applyManualTeamRanks(
  teamResults: ReturnType<typeof calculateTeamResults>,
  manualTeamRanks: ManualTeamRank[]
) {
  const rankByTeam = new Map(manualTeamRanks.map((row) => [row.teamColor, row.rank]));
  const ranks = manualTeamRanks.map((row) => row.rank);
  if (
    manualTeamRanks.length !== 3 ||
    rankByTeam.size !== 3 ||
    new Set(ranks).size !== 3 ||
    ranks.some((rank) => rank < 1 || rank > 3)
  ) {
    throw new Error("人工排名必须完整包含红、蓝、白三队，且第 1、2、3 名不能重复");
  }

  return teamResults
    .map((result) => {
      const rank = rankByTeam.get(result.teamColor as InternalTeamColor);
      if (!rank) throw new Error(`缺少 ${result.teamColor} 队的人工排名`);
      return {
        ...result,
        rank,
        seasonPointsAwarded: 4 - rank,
        needsManualReview: false
      };
    })
    .sort((left, right) => (left.rank ?? 99) - (right.rank ?? 99));
}

export async function confirmMatchDay(prisma: PrismaClient, input: ConfirmInput) {
  const parsed = parseResultSchema.parse(input.parsedJson);
  if (parsed.awards.some((award) => award.players.some((person) => person.trialPlayerId)) || parsed.bonusPoints.some((bonus) => bonus.player.trialPlayerId)) throw new Error("试训球员不参与正式个人奖项或额外积分");
  const missingPlayers = collectMissingPlayers(parsed);
  if (missingPlayers.length > 0) {
    throw new Error(`仍有未匹配球员，不能确认入库：${missingPlayers.join("、")}`);
  }

  const typedGames: InternalGameInput[] =
    parsed.matchType === "internal"
      ? parsed.games.map((game) => ({
          matchDayId: input.matchDayId,
          sectionNo: game.sectionNo,
          teamA: colorToDb[game.teamA],
          teamB: colorToDb[game.teamB],
          scoreA: game.scoreA,
          scoreB: game.scoreB
        }))
      : [];
  const calculatedTeamResults =
    parsed.matchType === "internal" ? calculateTeamResults(typedGames) : [];
  const needsManualRanking = calculatedTeamResults.some((result) => result.needsManualReview);
  if (parsed.matchType === "internal" && needsManualRanking && !input.manualTeamRanks && !parsed.games.some((game) => game.events.length)) {
    throw new TeamRankingConfirmationRequired(calculatedTeamResults);
  }
  const confirmedTeamResults =
    needsManualRanking && input.manualTeamRanks
      ? applyManualTeamRanks(calculatedTeamResults, input.manualTeamRanks)
      : calculatedTeamResults;

  return prisma.$transaction(async (tx) => {
    const matchDay = await tx.matchDay.findUnique({
      where: { id: input.matchDayId },
      include: { assignments: true, trialPlayers: true }
    });
    if (!matchDay) throw new Error("比赛日不存在");
    if (input.matchDayVersion && matchDay.updatedAt.toISOString() !== input.matchDayVersion) throw new MatchDayChanged();
    if (matchDay.type.toLowerCase() !== parsed.matchType) throw new Error("比赛类型与确认内容不一致");

    const requestedAssignments = input.teamAssignments ?? (Array.isArray(matchDay.draftAssignments) ? teamAssignmentInputSchema.array().parse(matchDay.draftAssignments) : undefined);
    const requestedTrials = input.trialPlayers ?? (Array.isArray(matchDay.draftTrialPlayers) ? trialPlayersInputSchema.parse(matchDay.draftTrialPlayers) : undefined);
    const trialPlayers = requestedTrials === undefined ? matchDay.trialPlayers ?? [] : trialPlayersInputSchema.parse(requestedTrials);
    if (parsed.matchType === "external" && trialPlayers.length) throw new Error("队外赛不支持试训身份");
    if (requestedTrials) await assertTrialPlayerScope(tx, input.matchDayId, trialPlayers);
    const aliasesToSave = input.saveAliases ?? [];
    const aliasOwnerIds = [...new Set(aliasesToSave.map((alias) => alias.playerId))];
    const aliasOwners = aliasOwnerIds.length
      ? await tx.player.findMany({
          where: { id: { in: aliasOwnerIds } },
          select: { id: true, name: true, aliases: { select: { alias: true } } }
        })
      : [];
    const aliasOwnerNameById = new Map(aliasOwners.map((player) => [player.id, player.name]));
    const existingAliasesByOwnerId = new Map(
      aliasOwners.map((player) => [
        player.id,
        new Set(player.aliases.map((alias) => alias.alias))
      ])
    );
    const missingAliasOwner = aliasOwnerIds.find((playerId) => !aliasOwnerNameById.has(playerId));
    if (missingAliasOwner) {
      throw new Error(`保存别名的球员不存在：${missingAliasOwner}`);
    }
    if (aliasesToSave.length > 0) {
      await assertPlayerPayloadsAvailable(
        tx,
        aliasOwnerIds.map((playerId) => ({
          ownerId: playerId,
          name: aliasOwnerNameById.get(playerId)!,
          aliases: aliasesToSave
            .filter((alias) => alias.playerId === playerId)
            .map((alias) => alias.rawName)
        })),
        { allowExistingAliasForSameOwner: true }
      );
    }

    const activeAssignments = requestedAssignments
      ? requestedAssignments.map((assignment) => ({
          matchDayId: input.matchDayId,
          teamColor: assignment.teamColor,
          playerId: assignment.playerId,
          pointsEligible: true
        }))
      : matchDay.assignments.map((assignment) => ({
          matchDayId: assignment.matchDayId,
          teamColor: assignment.teamColor,
          playerId: assignment.playerId,
          pointsEligible: true
        }));

    if (
      parsed.matchType === "internal" &&
      activeAssignments.filter((assignment) => assignment.teamColor !== "EXTERNAL").length === 0
    ) {
      throw new Error(
        "Internal match has no team assignments, so player rank points cannot be allocated. Please fill RED/BLUE/WHITE players before confirming."
      );
    }

    const resolutionByKey = new Map<string, EventResolution>();
    if (parsed.matchType === "internal") {
      const inspection = inspectInternalEvents(parsed, activeAssignments, trialPlayers);
      if (inspection.issues.length) throw new Error(inspection.issues.join("；"));
      const context = { matchDayId: input.matchDayId, updatedAt: matchDay.updatedAt, parsed, assignments: activeAssignments, trialPlayers };
      if (inspection.exceptions.length || trialPlayers.length || (requestedTrials && (matchDay.trialPlayers ?? []).length) || input.eventConfirmationToken) {
        const complete = inspection.exceptions.every((exception) => exception.team);
        if (!complete || !verifyEventConfirmation(input.eventConfirmationToken, context)) {
          throw new EventConfirmationRequired(inspection.exceptions, complete ? createEventConfirmation(context) : undefined);
        }
      }
      if (needsManualRanking && !input.manualTeamRanks) throw new TeamRankingConfirmationRequired(calculatedTeamResults);
      for (const resolution of inspection.resolutions) resolutionByKey.set(resolution.key, resolution);
    }
    const exceptionConfirmedAt = new Date();

    await tx.goalEvent.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.playerMatchdayPoint.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.teamMatchdayResult.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.award.deleteMany({ where: { matchDayId: input.matchDayId } });
    await tx.internalGame.deleteMany({ where: { matchDayId: input.matchDayId } });

    if (requestedTrials) await replaceTrialPlayers(tx, input.matchDayId, trialPlayers);

    if (requestedAssignments) {
      await tx.teamAssignment.deleteMany({ where: { matchDayId: input.matchDayId } });
      if (requestedAssignments.length > 0) {
        await tx.teamAssignment.createMany({
          data: requestedAssignments.map((assignment) => ({
            matchDayId: input.matchDayId,
            teamColor: assignment.teamColor,
            playerId: assignment.playerId,
            role: assignment.role ?? "PLAYER",
            isCaptain: assignment.isCaptain ?? false,
            pointsEligible: true
          })),
          skipDuplicates: true
        });
      }
    }

    for (const alias of aliasesToSave) {
      if (existingAliasesByOwnerId.get(alias.playerId)?.has(alias.rawName)) continue;
      const candidate: IdentityCandidate = {
        ownerId: alias.playerId,
        ownerName: aliasOwnerNameById.get(alias.playerId)!,
        value: alias.rawName,
        kind: "ALIAS"
      };
      await tx.playerAlias
        .create({
          data: {
            playerId: alias.playerId,
            alias: alias.rawName,
            aliasType: alias.aliasType
          }
        })
        .catch((error) => translatePlayerIdentityWriteError(error, [candidate]));
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

      for (const [gameIndex, game] of parsed.games.entries()) {
        for (const [eventIndex, event] of game.events.entries()) {
          if (!event.scorer.playerId && !event.scorer.trialPlayerId) continue;
          const resolution = resolutionByKey.get(`${gameIndex}:${eventIndex}`)!;
          event.team = resolution.teamColor.toLowerCase() as "red" | "blue" | "white";
          event.needsTeamSelection = false;
          await tx.goalEvent.create({
            data: {
              matchDayId: input.matchDayId,
              internalGameId: gameIdBySection.get(game.sectionNo),
              matchType: "INTERNAL",
              teamColor: resolution.teamColor,
              kind: event.type === "own_goal" ? "OWN_GOAL" : "NORMAL",
              scorerRosterTeam: resolution.scorerRosterTeam,
              assistRosterTeam: resolution.assistRosterTeam,
              exceptionConfirmedAt: resolution.isException ? exceptionConfirmedAt : null,
              exceptionConfirmedBy: resolution.isException ? getAdminCredentials().username : null,
              scorerId: event.scorer.playerId,
              scorerTrialPlayerId: event.scorer.trialPlayerId ?? null,
              assistTrialPlayerId: event.assist?.trialPlayerId ?? null,
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
              points: awardPointsForStorage(award.name, award.points),
              rawText: award.rawText
            }
          });
        }
      }

      const teamResults = confirmedTeamResults;
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
        award.points === 0 || isBestDefenderAwardName(award.name)
          ? []
          : award.players
              .filter((player) => player.playerId)
              .map((player) => ({
                playerId: player.playerId!,
                points: awardPointsForStorage(award.name, award.points),
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
              points: awardPointsForStorage(award.name, award.points),
              rawText: award.rawText
            }
          });
        }
      }
    }


    await tx.matchParseResult.create({
      data: {
        matchDayId: input.matchDayId,
        rawText: matchDay.rawText ?? "",
        parsedJson: parsed,
        modelName: "manual-confirmation",
        status: "SUCCESS"
      }
    });

    return tx.matchDay.update({
      where: { id: input.matchDayId },
      data: {
        parseStatus: "CONFIRMED",
        participantCorrections: unusedParticipantCorrections(parsed, Array.isArray(matchDay.participantCorrections) ? participantCorrectionsSchema.parse(matchDay.participantCorrections) : []),
        draftAssignments: Prisma.DbNull,
        draftTrialPlayers: Prisma.DbNull,
        confirmedAt: new Date()
      },
      include: {
        trialPlayers: true,
        assignments: { include: { player: true } },
        internalGames: true,
        goalEvents: true,
        teamResults: true,
        playerPoints: true,
        awards: true
      }
    });
  }, { isolationLevel: "Serializable" });
}
