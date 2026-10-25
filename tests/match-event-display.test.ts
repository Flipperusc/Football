import { describe, expect, it } from "vitest";
import { goalEventMarker } from "@/lib/match-events";

const game = { teamA: "WHITE" as const, teamB: "BLUE" as const };
describe("stored event markers", () => {
  it("shows explicit off-roster guest roles without reclassifying legacy null snapshots", () => {
    const event = { teamColor: "BLUE" as const, scorerRosterTeam: null, assistRosterTeam: null, scorerIsGuest: true, assistIsGuest: false };
    expect(goalEventMarker(event, game)).toBe("（代打）");
    expect(goalEventMarker(event, game, "assist")).toBe("");
    expect(goalEventMarker({ ...event, scorerIsGuest: false, assistIsGuest: true }, game, "assist")).toBe("（代打）");
    expect(goalEventMarker({ teamColor: "BLUE", scorerRosterTeam: null }, game)).toBe("");
  });
  it("labels normal guest scorers and assists separately", () => {
    const event = { kind: "NORMAL" as const, teamColor: "BLUE" as const, scorerRosterTeam: "BLUE" as const, assistRosterTeam: "RED" as const };
    expect(goalEventMarker(event, game)).toBe("");
    expect(goalEventMarker(event, game, "assist")).toBe("（代打）");
    expect(goalEventMarker({ ...event, scorerRosterTeam: "WHITE" }, game)).toBe("（代打）");
  });
  it("labels own goals against the acting team, including guest own goals", () => {
    const event = { kind: "OWN_GOAL" as const, teamColor: "BLUE" as const, scorerRosterTeam: "WHITE" as const };
    expect(goalEventMarker(event, game)).toBe("（乌龙）");
    expect(goalEventMarker({ ...event, scorerRosterTeam: "RED" }, game)).toBe("（代打、乌龙）");
    expect(goalEventMarker({ teamColor: "BLUE" }, game)).toBe("");
  });
});
