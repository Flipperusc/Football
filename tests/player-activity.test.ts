import { describe, expect, it } from "vitest";
import { buildPlayerActivities } from "@/lib/stats/player-activity";

describe("player activity timeline", () => {
  it("builds goal, assist, point and manual adjustment reasons", () => {
    const rows = buildPlayerActivities(
      [
        {
          id: "match-1",
          date: "2026-01-10T00:00:00.000Z",
          type: "INTERNAL",
          internalGames: [{ id: "game-1", sectionNo: 1 }],
          goalEvents: [
            {
              id: "goal-1",
              internalGameId: "game-1",
              scorerId: "player-1",
              assistPlayerId: "player-2",
              count: 1
            }
          ],
          playerPoints: [
            {
              id: "point-1",
              playerId: "player-1",
              basePoints: 3,
              bonusPoints: 1,
              reason: "当场最佳"
            }
          ]
        }
      ],
      [
        {
          id: "adjustment-1",
          playerId: "player-1",
          metric: "INTERNAL_GOALS",
          operation: "ADJUST",
          value: -1,
          reason: "更正重复进球",
          createdAt: "2026-01-11T08:00:00.000Z"
        }
      ]
    );

    expect(rows).toContainEqual(
      expect.objectContaining({
        playerId: "player-1",
        description: "1.10队内赛第一节进1球",
        changeLabel: "进球数 +1"
      })
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        playerId: "player-2",
        description: "1.10队内赛第一节完成1次助攻",
        changeLabel: "助攻数 +1"
      })
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        description: "1.10队内赛球队排名积分",
        changeLabel: "积分 +3"
      })
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        description: "1.10队内赛当场最佳",
        changeLabel: "积分 +1"
      })
    );
    expect(rows[0]).toEqual(
      expect.objectContaining({
        description: "1.11人工调整队内进球：更正重复进球",
        changeLabel: "进球数 -1"
      })
    );
  });
});
