import { describe, expect, it } from "vitest";
import {
  defaultRankingRuleKey,
  defaultRankingRuleScope,
  getRankingRule,
  getRankingRuleGroup,
  rankingRuleGroups
} from "@/lib/ranking-rules";

describe("ranking rules", () => {
  it("contains the complete public ranking catalog", () => {
    expect(
      Object.fromEntries(
        rankingRuleGroups.map((group) => [group.scope, group.rules.map((rule) => rule.key)])
      )
    ).toEqual({
      all: ["all-goals", "all-assists", "all-appearances", "all-goals-rate"],
      internal: [
        "internal-points",
        "internal-goalkeepers",
        "internal-goals",
        "internal-assists",
        "internal-appearances",
        "best-defenders",
        "internal-points-rate",
        "internal-goals-rate"
      ],
      external: ["external-goals", "external-assists", "external-appearances"]
    });
  });

  it("uses unique rule keys and complete rule sections", () => {
    const rules = rankingRuleGroups.flatMap((group) => group.rules);
    expect(new Set(rules.map((rule) => rule.key)).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule.description).not.toBe("");
      expect(rule.calculation).not.toBe("");
      expect(rule.eligibility).not.toBe("");
      expect(rule.sorting).not.toBe("");
      expect(rule.tieBreak).not.toBe("");
      expect(rule.notes.length).toBeGreaterThan(0);
    }
  });

  it("points the defaults to an existing internal rule", () => {
    expect(defaultRankingRuleScope).toBe("internal");
    expect(getRankingRuleGroup(defaultRankingRuleScope).rules[0].key).toBe(defaultRankingRuleKey);
    expect(getRankingRule(defaultRankingRuleKey)?.title).toBe("队内积分榜");
  });
});
