import { describe, expect, it } from "vitest";
import { shareEventText } from "@/lib/stats/share-events";
const game = {id: "g", teamA: "WHITE" as const, teamB: "BLUE" as const};
describe("separate share event sections", () => {
  it("separates own goals from normal goals and shows trial signatures without fake formal identities", () => {
    const events = [
      {internalGameId: "g", teamColor: "BLUE" as const, scorer: null, scorerTrialPlayer: {name: "试训甲"}, assistPlayer: {name: "张三"}, count: 1},
      {internalGameId: "g", teamColor: "BLUE" as const, scorer: {name: "李四"}, kind: "OWN_GOAL" as const, count: 2},
      {internalGameId: "g", teamColor: "BLUE" as const, scorer: {name: "张三"}, assistTrialPlayer: {name: "试训甲"}, count: 1}
    ];
    expect(shareEventText(game, "BLUE", events, "NORMAL")).toBe("试训甲（试训）、张三");
    expect(shareEventText(game, "BLUE", events, "OWN_GOAL")).toBe("李四（乌龙）×2");
    expect(shareEventText(game, "BLUE", events, "ASSIST")).toBe("张三、试训甲（试训）");
    expect(shareEventText(game, "RED", events, "NORMAL")).toBe("—");
  });
});
