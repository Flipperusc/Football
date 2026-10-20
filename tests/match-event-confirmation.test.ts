import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { confirmMatchDay } from "@/lib/server/confirm-matchday";

function fixture() {
  const assignments = [
    { matchDayId: "m", playerId: "guest", teamColor: "RED" },
    { matchDayId: "m", playerId: "helper", teamColor: "RED" },
    { matchDayId: "m", playerId: "absent", teamColor: "BLUE" },
    { matchDayId: "m", playerId: "own", teamColor: "WHITE" }
  ];
  const matchDay = { id: "m", type: "INTERNAL", rawText: "测试", updatedAt: new Date("2026-10-19T01:00:00Z"), assignments };
  const goals: Record<string, unknown>[] = [];
  const points: Record<string, unknown>[] = [];
  const tx = {
    matchDay: { findUnique: vi.fn(async () => matchDay), update: vi.fn(async () => ({ ...matchDay, goalEvents: [...goals], playerPoints: [...points] })) },
    player: { findMany: vi.fn(async () => assignments.map((row) => ({ id: row.playerId, name: row.playerId, aliases: [] }))) },
    goalEvent: { deleteMany: vi.fn(async () => { goals.length = 0; }), create: vi.fn(async ({ data }) => { goals.push(data); return data; }) },
    playerMatchdayPoint: { deleteMany: vi.fn(async () => { points.length = 0; }), createMany: vi.fn(async ({ data }) => { points.push(...data); }) },
    teamMatchdayResult: { deleteMany: vi.fn(), createMany: vi.fn() },
    award: { deleteMany: vi.fn(), create: vi.fn() },
    internalGame: { deleteMany: vi.fn(), create: vi.fn(async ({ data }) => ({ ...data, id: `game-${data.sectionNo}` })) },
    matchParseResult: { create: vi.fn() }
  };
  const prisma = { $transaction: vi.fn(async (callback) => callback(tx)) } as unknown as PrismaClient;
  const player = (id: string) => ({ playerId: id, rawName: id, confidence: 1 });
  const games = [
    { sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 2, rawText: "", events: [
      { type: "goal", team: "blue", scorer: player("guest"), assist: player("helper"), count: 1, rawText: "代打进球" },
      { type: "own_goal", team: "blue", scorer: player("own"), assist: null, count: 1, rawText: "乌龙" }
    ] },
    { sectionNo: 2, teamA: "white", teamB: "red", scoreA: 0, scoreB: 1, events: [], rawText: "" },
    { sectionNo: 3, teamA: "red", teamB: "blue", scoreA: 1, scoreB: 0, events: [], rawText: "" },
    { sectionNo: 4, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 0, events: [], rawText: "" },
    { sectionNo: 5, teamA: "white", teamB: "red", scoreA: 0, scoreB: 1, events: [], rawText: "" },
    { sectionNo: 6, teamA: "red", teamB: "blue", scoreA: 1, scoreB: 0, events: [], rawText: "" }
  ];
  return { prisma, tx, goals, points, matchDay, input: { matchDayId: "m", parsedJson: { matchType: "internal", games } } };
}

async function preview(data: ReturnType<typeof fixture>) {
  return confirmMatchDay(data.prisma, data.input).catch((error) => error) as Promise<{ code: string; confirmationToken?: string; exceptions: unknown[] }>;
}

describe("event confirmation protocol", () => {
  it("rejects a page edited against an older persisted match version", async () => {
    const data = fixture();
    await expect(confirmMatchDay(data.prisma, { ...data.input, matchDayVersion: "2026-10-18T01:00:00.000Z" })).rejects.toMatchObject({ code: "MATCH_DAY_CHANGED" });
    expect(data.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
  });
  it("returns every exception before touching existing formal data", async () => {
    const data = fixture();
    const pending = await preview(data);
    expect(pending.code).toBe("MATCH_EVENT_CONFIRMATION_REQUIRED");
    expect(pending.exceptions).toHaveLength(2);
    expect(pending.confirmationToken).toEqual(expect.any(String));
    expect(data.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
    expect(data.tx.matchDay.update).not.toHaveBeenCalled();
  });

  it("stores the confirmed attribution and audit data without transferring roster points", async () => {
    const data = fixture();
    const pending = await preview(data);
    const result = await confirmMatchDay(data.prisma, { ...data.input, eventConfirmationToken: pending.confirmationToken });
    expect(result.goalEvents).toEqual([
      expect.objectContaining({ scorerId: "guest", assistPlayerId: "helper", teamColor: "BLUE", kind: "NORMAL", scorerRosterTeam: "RED", assistRosterTeam: "RED", exceptionConfirmedAt: expect.any(Date), exceptionConfirmedBy: expect.any(String) }),
      expect.objectContaining({ scorerId: "own", assistPlayerId: null, teamColor: "BLUE", kind: "OWN_GOAL", scorerRosterTeam: "WHITE" })
    ]);
    expect(result.playerPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: "guest", basePoints: 3 }),
      expect.objectContaining({ playerId: "absent", basePoints: 2 }),
      expect.objectContaining({ playerId: "own", basePoints: 1 })
    ]));
    expect(result.assignments).toHaveLength(4);
  });

  it.each(["count", "version", "roster", "signature"])("rejects an old confirmation after %s changes", async (change) => {
    const data = fixture();
    const pending = await preview(data);
    if (change === "count") {
      data.input.parsedJson.games[0].events[0].count = 2;
      data.input.parsedJson.games[0].scoreB = 3;
    }
    if (change === "version") data.matchDay.updatedAt = new Date("2026-10-19T02:00:00Z");
    if (change === "roster") data.matchDay.assignments[1].teamColor = "WHITE";
    const token = change === "signature" ? `${pending.confirmationToken}x` : pending.confirmationToken;
    await expect(confirmMatchDay(data.prisma, { ...data.input, eventConfirmationToken: token })).rejects.toMatchObject({ code: "MATCH_EVENT_CONFIRMATION_REQUIRED" });
    expect(data.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps the same confirmation valid across the manual ranking step", async () => {
    const data = fixture();
    data.input.parsedJson.games[1].scoreB = 0;
    data.input.parsedJson.games[2].scoreA = 0;
    data.input.parsedJson.games[4].scoreB = 0;
    data.input.parsedJson.games[5].scoreA = 0;
    data.input.parsedJson.games[1].scoreA = 1;
    data.input.parsedJson.games[2].scoreB = 1;
    data.input.parsedJson.games[3].scoreA = 2;
    data.input.parsedJson.games[4].scoreA = 1;
    data.input.parsedJson.games[5].scoreB = 1;
    const pending = await preview(data);
    expect(pending.code).toBe("MATCH_EVENT_CONFIRMATION_REQUIRED");
    await expect(confirmMatchDay(data.prisma, { ...data.input, eventConfirmationToken: pending.confirmationToken })).rejects.toMatchObject({ code: "TEAM_RANKING_CONFIRMATION_REQUIRED" });
    await expect(confirmMatchDay(data.prisma, { ...data.input, eventConfirmationToken: pending.confirmationToken,
      manualTeamRanks: [{ teamColor: "BLUE", rank: 1 }, { teamColor: "WHITE", rank: 2 }, { teamColor: "RED", rank: 3 }]
    })).resolves.toHaveProperty("goalEvents");
  });

  it("cannot confirm an own goal with an assist or a mismatching match type", async () => {
    const data = fixture();
    const pending = await preview(data);
    data.input.parsedJson.games[0].events[1].assist = { playerId: "helper", rawName: "helper", confidence: 1 };
    await expect(confirmMatchDay(data.prisma, { ...data.input, eventConfirmationToken: pending.confirmationToken })).rejects.toThrow("乌龙球不计助攻");
    expect(data.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
    await expect(confirmMatchDay(data.prisma, { matchDayId: "m", parsedJson: { matchType: "external", events: [] } })).rejects.toThrow("类型");
  });
});
