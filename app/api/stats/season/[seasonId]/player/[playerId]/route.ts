import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadSeasonStats } from "@/lib/server/stats";
import type { RecentStatChange } from "@/lib/client-types";

const metricLabels = {
  INTERNAL_GOALS: "队内进球数",
  INTERNAL_ASSISTS: "队内助攻数",
  INTERNAL_APPEARANCES: "队内出勤",
  INTERNAL_SEASON_POINTS: "队内赛积分",
  EXTERNAL_GOALS: "队外进球数",
  EXTERNAL_ASSISTS: "队外助攻数",
  EXTERNAL_APPEARANCES: "队外出勤"
} as const;

function monthDay(value: Date) {
  return `${value.getMonth() + 1}.${value.getDate()}`;
}

function sectionLabel(sectionNo?: number | null) {
  const labels = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (!sectionNo) return "";
  return `第${labels[sectionNo] ?? sectionNo}节`;
}

function rankLabel(rank?: number | null) {
  if (rank === 1) return "夺冠";
  if (rank === 2) return "第二名";
  if (rank === 3) return "第三名";
  return "完成比赛";
}

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

  const [matchRecords, adjustments] = await Promise.all([
    prisma.matchDay.findMany({
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
    }),
    prisma.playerStatAdjustment.findMany({
      where: {
        seasonId: params.seasonId,
        playerId: params.playerId
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const recentChanges = [
    ...matchRecords.flatMap((matchDay) => {
      const dateText = monthDay(matchDay.date);
      const typeText = matchDay.type === "INTERNAL" ? "队内赛" : "队外赛";
      const changes: (RecentStatChange & { sortDate: Date })[] = [];

      for (const point of matchDay.playerPoints) {
        if (point.basePoints === 0) continue;
        const assignment = matchDay.assignments[0];
        const result = matchDay.teamResults.find(
          (row) => row.teamColor === assignment?.teamColor
        );
        const pointText = point.basePoints > 0 ? `加${point.basePoints}` : `减${Math.abs(point.basePoints)}`;
        changes.push({
          id: `point-${matchDay.id}-${point.id}`,
          date: matchDay.date.toISOString(),
          source: "MATCH",
          sortDate: matchDay.date,
          description: `${dateText}${typeText}${rankLabel(result?.rank)}，队内赛积分${pointText}`
        });
      }

      const awardsByName = new Map<string, { count: number; points: number; ids: string[] }>();
      for (const award of matchDay.awards) {
        if (award.points === 0) continue;
        const current = awardsByName.get(award.name) ?? { count: 0, points: 0, ids: [] };
        current.count += 1;
        current.points += award.points;
        current.ids.push(award.id);
        awardsByName.set(award.name, current);
      }
      for (const [awardName, awardSummary] of awardsByName) {
        const pointText =
          awardSummary.points > 0 ? `加${awardSummary.points}` : `减${Math.abs(awardSummary.points)}`;
        const countText = awardSummary.count > 1 ? `${awardSummary.count}次` : "";
        changes.push({
          id: `award-${awardSummary.ids.join("-")}`,
          date: matchDay.date.toISOString(),
          source: "MATCH",
          sortDate: matchDay.date,
          description: `${dateText}${typeText}${awardName}${countText}，队内赛积分${pointText}`
        });
      }

      for (const point of matchDay.playerPoints) {
        const awardPoints = matchDay.awards.reduce((sum, award) => sum + award.points, 0);
        const otherBonusPoints = point.bonusPoints - awardPoints;
        if (otherBonusPoints === 0) continue;
        const pointText =
          otherBonusPoints > 0 ? `加${otherBonusPoints}` : `减${Math.abs(otherBonusPoints)}`;
        changes.push({
          id: `bonus-${matchDay.id}-${point.id}`,
          date: matchDay.date.toISOString(),
          source: "MATCH",
          sortDate: matchDay.date,
          description: `${dateText}${typeText}${point.reason ?? "额外加分"}，队内赛积分${pointText}`
        });
      }

      for (const event of matchDay.goalEvents) {
        const sectionText =
          matchDay.type === "INTERNAL" ? sectionLabel(event.internalGame?.sectionNo) : "";
        if (event.scorerId === params.playerId) {
          changes.push({
            id: `goal-${event.id}`,
            date: matchDay.date.toISOString(),
            source: "MATCH",
            sortDate: matchDay.date,
            description: `${dateText}${typeText}${sectionText}进${event.count}球，进球数加${event.count}`
          });
        }
        if (event.assistPlayerId === params.playerId) {
          changes.push({
            id: `assist-${event.id}`,
            date: matchDay.date.toISOString(),
            source: "MATCH",
            sortDate: matchDay.date,
            description: `${dateText}${typeText}${sectionText}助攻${event.count}次，助攻数加${event.count}`
          });
        }
      }

      return changes;
    }),
    ...adjustments.map((adjustment) => {
      const valueText =
        adjustment.operation === "SET"
          ? `设置${metricLabels[adjustment.metric]}为${adjustment.value}`
          : `调整${metricLabels[adjustment.metric]}${adjustment.value >= 0 ? "加" : "减"}${Math.abs(adjustment.value)}`;

      return {
        id: `admin-${adjustment.id}`,
        date: adjustment.createdAt.toISOString(),
        source: "ADMIN" as const,
        sortDate: adjustment.createdAt,
        description: `${monthDay(adjustment.createdAt)}管理员${valueText}，原因：${adjustment.reason}`
      };
    })
  ]
    .sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime())
    .slice(0, 5)
    .map(({ sortDate: _sortDate, ...change }) => change);

  return NextResponse.json({
    player,
    stats: stats.playerStats.find((item) => item.playerId === params.playerId),
    matchRecords,
    recentChanges
  });
}
