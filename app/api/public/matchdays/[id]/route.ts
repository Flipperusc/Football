import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const matchDay = await prisma.matchDay.findFirst({
      where: { id: params.id, parseStatus: "CONFIRMED" },
      select: {
        id: true,
        date: true,
        type: true,
        parseStatus: true,
        season: { select: { name: true } },
        internalGames: {
          select: {
            id: true,
            sectionNo: true,
            teamA: true,
            teamB: true,
            scoreA: true,
            scoreB: true
          },
          orderBy: { sectionNo: "asc" }
        },
        goalEvents: {
          select: {
            id: true,
            internalGameId: true,
            teamColor: true,
            kind: true,
            scorerRosterTeam: true,
            assistRosterTeam: true,
            scorerId: true,
            assistPlayerId: true,
            count: true,
            scorer: { select: { id: true, name: true } },
            scorerTrialPlayer: { select: { id: true, name: true } },
            assistTrialPlayer: { select: { id: true, name: true } },
            assistPlayer: { select: { id: true, name: true } }
          }
        },
        teamResults: {
          select: {
            teamColor: true,
            matchPoints: true,
            goalsFor: true,
            goalsAgainst: true,
            goalDifference: true,
            rank: true
          }
        }
      }
    });

    if (!matchDay) {
      return NextResponse.json({ message: "比赛不存在或尚未确认" }, { status: 404 });
    }
    return NextResponse.json(matchDay);
  } catch (error) {
    return apiErrorResponse(error, "获取公开赛后战报失败");
  }
}
