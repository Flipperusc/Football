import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadSeasonStats } from "@/lib/server/stats";

export async function GET(
  _: Request,
  { params }: { params: { seasonId: string; playerId: string } }
) {
  const stats = await loadSeasonStats(params.seasonId);
  if (!stats) return NextResponse.json({ message: "Season not found" }, { status: 404 });

  const player = await prisma.player.findUnique({
    where: { id: params.playerId },
    include: { aliases: true }
  });
  if (!player) return NextResponse.json({ message: "Player not found" }, { status: 404 });

  const matchRecords = await prisma.matchDay.findMany({
    where: {
      seasonId: params.seasonId,
      OR: [
        { assignments: { some: { playerId: params.playerId } } },
        {
          goalEvents: {
            some: { OR: [{ scorerId: params.playerId }, { assistPlayerId: params.playerId }] }
          }
        }
      ]
    },
    include: {
      assignments: { where: { playerId: params.playerId } },
      goalEvents: {
        where: { OR: [{ scorerId: params.playerId }, { assistPlayerId: params.playerId }] },
        include: { scorer: true, assistPlayer: true, internalGame: true }
      },
      playerPoints: { where: { playerId: params.playerId } },
      awards: { where: { playerId: params.playerId } },
      teamResults: true
    },
    orderBy: { date: "desc" }
  });

  return NextResponse.json({
    player,
    stats: stats.playerStats.find((item) => item.playerId === params.playerId),
    matchRecords
  });
}
