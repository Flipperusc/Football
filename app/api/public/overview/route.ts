import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { loadSeasonStats } from "@/lib/server/stats";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requestedSeasonId = new URL(request.url).searchParams.get("seasonId") ?? undefined;
    const [seasons, players, photos] = await Promise.all([
      prisma.season.findMany({ orderBy: { startDate: "desc" } }),
      prisma.player.findMany({
        select: {
          id: true,
          name: true,
          jerseyNumber: true,
          position: true,
          avatarUrl: true,
          status: true
        },
        orderBy: { name: "asc" }
      }),
      prisma.teamPhoto.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }]
      })
    ]);

    const selectedSeason =
      seasons.find((season) => season.id === requestedSeasonId) ??
      seasons.find((season) => season.status === "ACTIVE") ??
      seasons[0];
    const seasonData = selectedSeason ? await loadSeasonStats(selectedSeason.id) : null;

    const matches = (seasonData?.matchDays ?? [])
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((matchDay) => ({
        id: matchDay.id,
        date: matchDay.date,
        type: matchDay.type,
        confirmedAt: matchDay.confirmedAt,
        goalCount: matchDay.goalEvents.reduce((sum, event) => sum + event.count, 0),
        playerCount: matchDay.assignments.length,
        teamResults: matchDay.teamResults
          .filter((result) => result.teamColor !== "EXTERNAL")
          .map((result) => ({
            teamColor: result.teamColor,
            matchPoints: result.matchPoints,
            goalsFor: result.goalsFor,
            goalsAgainst: result.goalsAgainst,
            goalDifference: result.goalDifference,
            rank: result.rank
          }))
      }));

    return NextResponse.json({
      seasons,
      selectedSeasonId: selectedSeason?.id,
      players,
      photos,
      stats: seasonData?.playerStats ?? [],
      matches
    });
  } catch (error) {
    return apiErrorResponse(error, "获取公开球队数据失败");
  }
}
