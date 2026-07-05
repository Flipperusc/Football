import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRosterWithAi } from "@/lib/ai/roster";
import type { ParserPlayer } from "@/lib/ai/local-parser";

const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;

const rosterNames = {
  RED: [
    "\u679c\u4e4b\u6797",
    "\u6b27\u5df4",
    "\u5341\u4e09",
    "\u96ea\u5b50",
    "\u5c0f\u4f55",
    "\u9053\u957f",
    "\u8d39\u5bb6\u5bb6",
    "\u5c0f\u738b"
  ],
  BLUE: [
    "\u8096\u8001\u5e08",
    "\u9648\u5c11",
    "\u4fca\u951f",
    "\u5218\u5fd7",
    "\u61c2\u4e8b\u957f",
    "\u5b87\u54e5",
    "\u66fe\u7426",
    "\u4e07\u65b0"
  ],
  WHITE: [
    "\u6e38\u8001\u5e08",
    "\u67f3\u65ed",
    "\u96f7\u5dde",
    "\u9676\u9676",
    "\u5468\u6770",
    "\u5927\u5723",
    "\u725b\u54e5",
    "\u5f20\u4eae"
  ]
} as const;

function buildPlayers(): ParserPlayer[] {
  return Object.values(rosterNames)
    .flat()
    .map((name, index) => ({
      id: `p${index + 1}`,
      name,
      aliases: []
    }));
}

function namesForTeam(
  assignments: Awaited<ReturnType<typeof parseRosterWithAi>>["parsed"]["assignments"],
  teamColor: keyof typeof rosterNames
) {
  return assignments.filter((row) => row.teamColor === teamColor).map((row) => row.matchedName);
}

function rolesForTeam(
  assignments: Awaited<ReturnType<typeof parseRosterWithAi>>["parsed"]["assignments"],
  teamColor: keyof typeof rosterNames
) {
  return assignments.filter((row) => row.teamColor === teamColor).map((row) => row.role);
}

describe("roster parsing", () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    if (previousDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("ignores Arabic digits and marks the last Chinese player in each internal team as goalkeeper", async () => {
    const rawText = [
      "\u7ea2",
      ...rosterNames.RED.slice(0, -1),
      "10",
      rosterNames.RED[rosterNames.RED.length - 1],
      "\u84dd",
      ...rosterNames.BLUE.slice(0, -1),
      "10",
      rosterNames.BLUE[rosterNames.BLUE.length - 1],
      "\u767d",
      ...rosterNames.WHITE.slice(0, -1),
      "10",
      rosterNames.WHITE[rosterNames.WHITE.length - 1]
    ].join("\n");

    const result = await parseRosterWithAi({
      rawText,
      matchType: "INTERNAL",
      players: buildPlayers()
    });

    expect(result.usedFallback).toBe(true);
    expect(result.parsed.assignments).toHaveLength(24);
    expect(result.parsed.assignments.map((row) => row.rawName)).not.toContain("10");
    expect(namesForTeam(result.parsed.assignments, "RED")).toEqual(rosterNames.RED);
    expect(namesForTeam(result.parsed.assignments, "BLUE")).toEqual(rosterNames.BLUE);
    expect(namesForTeam(result.parsed.assignments, "WHITE")).toEqual(rosterNames.WHITE);
    expect(rolesForTeam(result.parsed.assignments, "RED")).toEqual([
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "GOALKEEPER"
    ]);
    expect(rolesForTeam(result.parsed.assignments, "BLUE")).toEqual([
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "GOALKEEPER"
    ]);
    expect(rolesForTeam(result.parsed.assignments, "WHITE")).toEqual([
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "GOALKEEPER"
    ]);
  });
});
