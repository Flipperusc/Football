import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { internalParseResultSchema } from "@/lib/ai/schemas";
import { resolveTrial } from "@/lib/server/resolve-trial";

describe("trial promotion response recovery", () => {
  it("preserves intervening local score, event, trial and correction edits after a lost response", async () => {
    const trial = { id: "94ad9d13-509c-4e4c-a70b-871c69428223", name: "试训甲", confirmed: false };
    const otherTrial = { id: "abb4e1f0-4a9f-4d4e-9905-dee810ed1ca5", name: "试训乙", confirmed: true };
    const player = { id: "p1", name: "张三", aliases: [] };
    const version = new Date("2026-10-25T02:00:00.000Z");
    const original = internalParseResultSchema.parse({ matchType: "internal", games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 1, rawText: "第一节白蓝0:1", events: [
      { type: "goal", team: "blue", scorer: { playerId: null, trialPlayerId: trial.id, rawName: trial.name, confidence: 1 }, rawText: "原始进球" }
    ] }] });
    const edited = structuredClone(original);
    edited.games[0].scoreB = 2;
    edited.games[0].events[0].count = 2;
    const tx = {
      $executeRaw: vi.fn(), $queryRaw: vi.fn(),
      trialResolution: { findUnique: vi.fn().mockResolvedValue({ id: trial.id, sourceName: trial.name, requestedName: player.name, playerId: player.id, player, matchDayId: "match", resultVersion: version }) },
      matchDay: { findUnique: vi.fn().mockResolvedValue({ id: "match", type: "INTERNAL", updatedAt: version, participantCorrections: [{ rawName: trial.name, playerId: player.id }], draftTrialPlayers: [], trialPlayers: [], parseResults: [{ parsedJson: original }] }), update: vi.fn() },
      trialPlayer: { findMany: vi.fn().mockResolvedValue([]) },
      player: { findMany: vi.fn().mockResolvedValue([player]), create: vi.fn() }
    };
    const prisma = { $transaction: (work: (db: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    const result = await resolveTrial(prisma, {
      trialId: trial.id, trialPlayers: [trial, otherTrial], name: player.name, matchDayId: "match",
      matchDayVersion: "2026-10-25T01:00:00.000Z", parsedJson: edited,
      participantCorrections: [{ rawName: "本场新纠正", playerId: player.id }]
    });
    expect(result.trialPlayers).toEqual([otherTrial]);
    expect(result.parsedJson?.games[0]).toMatchObject({ scoreB: 2, events: [{ count: 2, scorer: { playerId: player.id, trialPlayerId: null } }] });
    expect(result.participantCorrections).toEqual(expect.arrayContaining([{ rawName: "本场新纠正", playerId: player.id }]));
    expect(tx.player.create).not.toHaveBeenCalled();
    expect(tx.matchDay.update).not.toHaveBeenCalled();
  });
});
