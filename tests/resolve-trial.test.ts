import { describe, expect, it } from "vitest";
import { resolveTrialSchema } from "@/lib/validations";

const trialId = "94ad9d13-509c-4e4c-a70b-871c69428223";
const input = { trialId, trialPlayers: [{ id: trialId, name: "试训甲", confirmed: false }], name: "正式甲" };
describe("trial resolution request", () => {
  it("accepts a new formal name or an existing formal player without a roster", () => {
    expect(resolveTrialSchema.parse(input).name).toBe("正式甲");
    expect(resolveTrialSchema.parse({ ...input, name: undefined, playerId: "existing" }).playerId).toBe("existing");
  });
  it("requires one identity decision and a current version for saved matches", () => {
    expect(resolveTrialSchema.safeParse({ ...input, name: " " }).success).toBe(false);
    expect(resolveTrialSchema.safeParse({ ...input, playerId: "existing" }).success).toBe(false);
    expect(resolveTrialSchema.safeParse({ ...input, matchDayId: "m" }).success).toBe(false);
    expect(resolveTrialSchema.safeParse({ ...input, matchDayId: "m", matchDayVersion: "2026-10-25T01:00:00.000Z" }).success).toBe(true);
  });
  it("requires the target to be in the submitted trial identities", () => {
    expect(resolveTrialSchema.safeParse({ ...input, trialPlayers: [] }).success).toBe(false);
  });
});
