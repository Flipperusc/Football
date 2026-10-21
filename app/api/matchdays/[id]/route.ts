import { assertParticipantCorrections } from "@/lib/server/participant-corrections";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { matchDayUpdateSchema, teamAssignmentInputSchema, trialPlayersInputSchema } from "@/lib/validations";
import { assertTrialPlayerScope, replaceTrialPlayers } from "@/lib/server/trial-players";
import { apiErrorResponse } from "@/lib/server/api-error";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const matchDay = await prisma.matchDay.findUnique({
    where: { id: params.id },
    include: {
      trialPlayers: true,
      season: true,
      assignments: { include: { player: true } },
      internalGames: { include: { goals: true }, orderBy: { sectionNo: "asc" } },
      goalEvents: { include: { scorer: true, assistPlayer: true, scorerTrialPlayer: true, assistTrialPlayer: true } },
      teamResults: true,
      playerPoints: true,
      awards: true,
      parseResults: { orderBy: { createdAt: "desc" }, take: 5 }
    }
  });
  if (!matchDay) return NextResponse.json({ message: "Match day not found" }, { status: 404 });
  const draftAssignments = Array.isArray(matchDay.draftAssignments) ? teamAssignmentInputSchema.array().parse(matchDay.draftAssignments) : undefined;
  const draftTrials = Array.isArray(matchDay.draftTrialPlayers) ? trialPlayersInputSchema.parse(matchDay.draftTrialPlayers) : undefined;
  const players = draftAssignments ? await prisma.player.findMany({ where: { id: { in: draftAssignments.map((row) => row.playerId) } } }) : [];
  return NextResponse.json({ ...matchDay,
    assignments: draftAssignments ? draftAssignments.map((row) => ({ ...row, id: `draft-${row.playerId}`, matchDayId: params.id, player: players.find((player) => player.id === row.playerId) })) : matchDay.assignments,
    trialPlayers: draftTrials ? draftTrials.map((row) => ({ ...row, matchDayId: params.id })) : matchDay.trialPlayers
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
  const body = matchDayUpdateSchema.parse(await request.json());
  const { assignments, trialPlayers, ...data } = body;
  const matchDay = await prisma.$transaction(async (tx) => {
    const current = await tx.matchDay.findUniqueOrThrow({ where: { id: params.id }, include: { assignments: true } });
    if (current.type !== "INTERNAL" && trialPlayers?.length) throw new Error("队外赛不支持试训身份");
    if (trialPlayers) await assertTrialPlayerScope(tx, params.id, trialPlayers);
    const previousAssignments = Array.isArray(current.draftAssignments) ? teamAssignmentInputSchema.array().parse(current.draftAssignments) : current.assignments;
    if (body.participantCorrections) await assertParticipantCorrections(tx, body.participantCorrections, assignments ?? previousAssignments, current.type);
    if (assignments) for (const row of assignments) row.pointsEligible ??= previousAssignments.find((old) => old.playerId === row.playerId)?.pointsEligible ?? true;
    if (current.confirmedAt) {
      return tx.matchDay.update({ where: { id: params.id }, data: { ...data, parseStatus: "CONFIRMED", draftAssignments: assignments, draftTrialPlayers: trialPlayers }, include: { assignments: { include: { player: true } }, trialPlayers: true, season: true } });
    }
    if (trialPlayers) await replaceTrialPlayers(tx, params.id, trialPlayers);
    if (assignments) {
      await tx.teamAssignment.deleteMany({ where: { matchDayId: params.id } });
      if (assignments.length) await tx.teamAssignment.createMany({ data: assignments.map((assignment) => ({ matchDayId: params.id, ...assignment })), skipDuplicates: true });
    }

    return tx.matchDay.update({
      where: { id: params.id },
      data: { ...data, ...(trialPlayers ? { draftTrialPlayers: Prisma.DbNull } : {}) },
      include: {
        assignments: { include: { player: true } },
        trialPlayers: true,
        season: true
      }
    });
  });
  return NextResponse.json(matchDay);
  } catch (error) { return apiErrorResponse(error, "保存比赛日失败"); }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const matchDay = await prisma.matchDay.findUnique({
      where: { id: params.id },
      select: { id: true }
    });

    if (!matchDay) {
      return NextResponse.json({ message: "\u6bd4\u8d5b\u5f55\u5165\u4e0d\u5b58\u5728\u6216\u5df2\u88ab\u5220\u9664" }, { status: 404 });
    }

    await prisma.matchDay.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "\u5220\u9664\u6bd4\u8d5b\u5f55\u5165\u5931\u8d25");
  }
}
