import {
  formatStatAdjustmentValue,
  statAdjustmentMetricLabels,
  type StatAdjustmentMetric,
  type StatAdjustmentOperation
} from "@/lib/stat-adjustments";

export type PlayerActivity = {
  id: string;
  playerId: string;
  occurredAt: string;
  description: string;
  changeLabel: string;
  kind: "GOAL" | "OWN_GOAL" | "ASSIST" | "POINT" | "MANUAL";
};

type MatchActivityInput = {
  id: string;
  date: Date | string;
  type: "INTERNAL" | "EXTERNAL";
  internalGames: { id: string; sectionNo: number }[];
  goalEvents: {
    kind?: "NORMAL" | "OWN_GOAL";
    id: string;
    internalGameId?: string | null;
    scorerId: string;
    assistPlayerId?: string | null;
    count: number;
  }[];
  playerPoints: {
    id: string;
    playerId: string;
    basePoints: number;
    bonusPoints: number;
    reason?: string | null;
  }[];
};

type AdjustmentActivityInput = {
  id: string;
  playerId: string;
  metric: StatAdjustmentMetric;
  operation: StatAdjustmentOperation;
  value: number;
  reason: string;
  createdAt: Date | string;
};

const sectionNumbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function asDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function monthDay(value: Date | string) {
  const date = asDate(value);
  return `${date.getUTCMonth() + 1}.${date.getUTCDate()}`;
}

function occurredAt(value: Date | string) {
  return asDate(value).toISOString();
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function sectionText(sectionNo?: number) {
  if (!sectionNo) return "";
  return `第${sectionNumbers[sectionNo] ?? sectionNo}节`;
}

function manualChangeLabel(metric: StatAdjustmentMetric, operation: StatAdjustmentOperation, value: number) {
  const label =
    metric === "INTERNAL_SEASON_POINTS"
      ? "积分"
      : metric === "INTERNAL_GOALS" || metric === "EXTERNAL_GOALS"
        ? "进球数"
        : metric === "INTERNAL_ASSISTS" || metric === "EXTERNAL_ASSISTS"
          ? "助攻数"
          : "出勤";
  return `${label} ${formatStatAdjustmentValue(operation, value)}`;
}

export function buildPlayerActivities(
  matches: MatchActivityInput[],
  adjustments: AdjustmentActivityInput[]
) {
  const rows: PlayerActivity[] = [];

  for (const match of matches) {
    const dateLabel = monthDay(match.date);
    const matchLabel = match.type === "INTERNAL" ? "队内赛" : "队外赛";
    const sections = new Map(match.internalGames.map((game) => [game.id, game.sectionNo]));
    const matchOccurredAt = occurredAt(match.date);

    for (const event of match.goalEvents) {
      const context = `${dateLabel}${matchLabel}${sectionText(
        event.internalGameId ? sections.get(event.internalGameId) : undefined
      )}`;
      if (event.kind === "OWN_GOAL") {
        rows.push({ id: `own-goal-${event.id}`, playerId: event.scorerId, occurredAt: matchOccurredAt,
          description: `${context}发生${event.count}次乌龙球`, changeLabel: "不计个人进球和助攻", kind: "OWN_GOAL" });
        continue;
      }
      rows.push({
        id: `goal-${event.id}`,
        playerId: event.scorerId,
        occurredAt: matchOccurredAt,
        description: `${context}进${event.count}球`,
        changeLabel: `进球数 ${signed(event.count)}`,
        kind: "GOAL"
      });
      if (event.assistPlayerId) {
        rows.push({
          id: `assist-${event.id}`,
          playerId: event.assistPlayerId,
          occurredAt: matchOccurredAt,
          description: `${context}完成${event.count}次助攻`,
          changeLabel: `助攻数 ${signed(event.count)}`,
          kind: "ASSIST"
        });
      }
    }

    for (const point of match.playerPoints) {
      if (point.basePoints !== 0) {
        rows.push({
          id: `point-base-${point.id}`,
          playerId: point.playerId,
          occurredAt: matchOccurredAt,
          description: `${dateLabel}${matchLabel}球队排名积分`,
          changeLabel: `积分 ${signed(point.basePoints)}`,
          kind: "POINT"
        });
      }
      if (point.bonusPoints !== 0) {
        rows.push({
          id: `point-bonus-${point.id}`,
          playerId: point.playerId,
          occurredAt: matchOccurredAt,
          description: `${dateLabel}${matchLabel}${point.reason ?? "额外加分"}`,
          changeLabel: `积分 ${signed(point.bonusPoints)}`,
          kind: "POINT"
        });
      }
    }
  }

  for (const adjustment of adjustments) {
    rows.push({
      id: `manual-${adjustment.id}`,
      playerId: adjustment.playerId,
      occurredAt: occurredAt(adjustment.createdAt),
      description: `${monthDay(adjustment.createdAt)}人工调整${statAdjustmentMetricLabels[adjustment.metric]}：${adjustment.reason}`,
      changeLabel: manualChangeLabel(adjustment.metric, adjustment.operation, adjustment.value),
      kind: "MANUAL"
    });
  }

  return rows.sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id)
  );
}
