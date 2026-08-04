import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { confirmMatchDay } from "@/lib/server/confirm-matchday";
import { PlayerIdentityConflictError } from "@/lib/server/player-identities";

describe("confirmMatchDay identity preflight", () => {
  it("does not delete formal match data when a saved alias conflicts", async () => {
    const formalDeletes = {
      goalEvent: vi.fn(),
      playerMatchdayPoint: vi.fn(),
      teamMatchdayResult: vi.fn(),
      award: vi.fn(),
      internalGame: vi.fn()
    };
    const tx = {
      matchDay: {
        findUnique: vi.fn().mockResolvedValue({ id: "match-1", assignments: [] })
      },
      player: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "player-1", name: "甲", aliases: [] }])
          .mockResolvedValueOnce([
            { id: "player-1", name: "甲", status: "ACTIVE", aliases: [] },
            {
              id: "player-2",
              name: "乙",
              status: "ACTIVE",
              aliases: [{ alias: "共享名" }]
            }
          ])
      },
      goalEvent: { deleteMany: formalDeletes.goalEvent },
      playerMatchdayPoint: { deleteMany: formalDeletes.playerMatchdayPoint },
      teamMatchdayResult: { deleteMany: formalDeletes.teamMatchdayResult },
      award: { deleteMany: formalDeletes.award },
      internalGame: { deleteMany: formalDeletes.internalGame }
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    } as unknown as PrismaClient;

    await expect(
      confirmMatchDay(prisma, {
        matchDayId: "match-1",
        parsedJson: {
          matchType: "external",
          events: [],
          awards: [],
          bonusPoints: [],
          uncertainItems: []
        },
        saveAliases: [
          { playerId: "player-1", rawName: "共享名", aliasType: "MANUAL" }
        ]
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "PLAYER_ALIAS_CONFLICT",
      value: "共享名"
    } satisfies Partial<PlayerIdentityConflictError>);

    expect(formalDeletes.goalEvent).not.toHaveBeenCalled();
    expect(formalDeletes.playerMatchdayPoint).not.toHaveBeenCalled();
    expect(formalDeletes.teamMatchdayResult).not.toHaveBeenCalled();
    expect(formalDeletes.award).not.toHaveBeenCalled();
    expect(formalDeletes.internalGame).not.toHaveBeenCalled();
  });
});
