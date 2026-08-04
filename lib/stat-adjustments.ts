export type StatAdjustmentMetric =
  | "INTERNAL_GOALS"
  | "INTERNAL_ASSISTS"
  | "INTERNAL_APPEARANCES"
  | "INTERNAL_SEASON_POINTS"
  | "EXTERNAL_GOALS"
  | "EXTERNAL_ASSISTS"
  | "EXTERNAL_APPEARANCES";

export type StatAdjustmentOperation = "SET" | "ADJUST";

export const statAdjustmentMetricLabels: Record<StatAdjustmentMetric, string> = {
  INTERNAL_SEASON_POINTS: "队内赛积分",
  INTERNAL_GOALS: "队内进球",
  INTERNAL_ASSISTS: "队内助攻",
  INTERNAL_APPEARANCES: "队内出勤",
  EXTERNAL_GOALS: "队外进球",
  EXTERNAL_ASSISTS: "队外助攻",
  EXTERNAL_APPEARANCES: "队外出勤"
};

export function formatStatAdjustmentValue(
  operation: StatAdjustmentOperation,
  value: number
) {
  if (operation === "SET") return `设置为 ${value}`;
  return value > 0 ? `+${value}` : String(value);
}
