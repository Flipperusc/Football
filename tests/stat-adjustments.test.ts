import { describe, expect, it } from "vitest";
import {
  formatStatAdjustmentValue,
  statAdjustmentMetricLabels
} from "@/lib/stat-adjustments";

describe("stat adjustment presentation", () => {
  it("formats additions, reductions and absolute settings", () => {
    expect(formatStatAdjustmentValue("ADJUST", 2)).toBe("+2");
    expect(formatStatAdjustmentValue("ADJUST", -1)).toBe("-1");
    expect(formatStatAdjustmentValue("SET", 3)).toBe("设置为 3");
  });

  it("provides readable labels for supported manual metrics", () => {
    expect(statAdjustmentMetricLabels.INTERNAL_SEASON_POINTS).toBe("队内赛积分");
    expect(statAdjustmentMetricLabels.EXTERNAL_ASSISTS).toBe("队外助攻");
  });
});
