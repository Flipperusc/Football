import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  confirmMatchDay,
  TeamRankingConfirmationRequired
} from "@/lib/server/confirm-matchday";
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
        findUnique: vi.fn().mockResolvedValue({ id: "match-1", type: "EXTERNAL", assignments: [] })
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
  it("does not start a transaction before unresolved team rankings are confirmed", async () => {
    const prisma = {
      $transaction: vi.fn()
    } as unknown as PrismaClient;

    await expect(
      confirmMatchDay(prisma, {
        matchDayId: "match-1",
        parsedJson: {
          matchType: "internal",
          games: [
            { sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 0, events: [], rawText: "" },
            { sectionNo: 2, teamA: "white", teamB: "red", scoreA: 0, scoreB: 0, events: [], rawText: "" },
            { sectionNo: 3, teamA: "red", teamB: "blue", scoreA: 0, scoreB: 0, events: [], rawText: "" }
          ],
          awards: [],
          bonusPoints: [],
          uncertainItems: []
        }
      })
    ).rejects.toBeInstanceOf(TeamRankingConfirmationRequired);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes a normal roster goal without an exception confirmation", async () => {
    const goalCreate = vi.fn().mockResolvedValue({ id: "goal-1" });
    const tx = {
      matchDay: {
        findUnique: vi.fn().mockResolvedValue({
          id: "match-1",
          rawText: "第一节 1:0 甲进球",
          type: "INTERNAL",
          assignments: [{ matchDayId: "match-1", playerId: "player-1", teamColor: "WHITE" }]
        }),
        update: vi.fn().mockResolvedValue({ id: "match-1" })
      },
      player: { findMany: vi.fn() },
      goalEvent: { deleteMany: vi.fn(), create: goalCreate },
      playerMatchdayPoint: { deleteMany: vi.fn(), createMany: vi.fn() },
      teamMatchdayResult: { deleteMany: vi.fn(), createMany: vi.fn() },
      award: { deleteMany: vi.fn(), create: vi.fn() },
      internalGame: {
        deleteMany: vi.fn(),
        create: vi.fn(({ data }) => Promise.resolve({ id: `game-${data.sectionNo}`, sectionNo: data.sectionNo }))
      },
      playerAlias: { create: vi.fn() },
      matchParseResult: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    } as unknown as PrismaClient;

    await confirmMatchDay(prisma, {
      matchDayId: "match-1",
      parsedJson: {
        matchType: "internal",
        games: [
          {
            sectionNo: 1,
            teamA: "white",
            teamB: "blue",
            scoreA: 1,
            scoreB: 0,
            rawText: "第一节 1:0 甲进球",
            events: [
              {
                type: "goal",
                team: "white",
                scorer: { rawName: "甲", playerId: "player-1", confidence: 1, candidates: [] },
                assist: null,
                count: 1,
                rawText: "甲进球",
                confidence: 1,
                needsReview: false
              }
            ]
          },
          { sectionNo: 2, teamA: "white", teamB: "red", scoreA: 0, scoreB: 0, events: [], rawText: "" },
          { sectionNo: 3, teamA: "red", teamB: "blue", scoreA: 0, scoreB: 0, events: [], rawText: "" }
        ],
        awards: [],
        bonusPoints: [],
        uncertainItems: []
      },
      manualTeamRanks: [
        { teamColor: "WHITE", rank: 1 },
        { teamColor: "RED", rank: 2 },
        { teamColor: "BLUE", rank: 3 }
      ]
    });

    expect(goalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ scorerId: "player-1", teamColor: "WHITE" })
    });
  });

  it("rejects a cross-team assist before deleting confirmed data", async () => {
    const formalDeletes = {
      goalEvent: vi.fn(),
      playerMatchdayPoint: vi.fn(),
      teamMatchdayResult: vi.fn(),
      award: vi.fn(),
      internalGame: vi.fn()
    };
    const tx = {
      matchDay: {
        findUnique: vi.fn().mockResolvedValue({
          id: "match-1",
          type: "INTERNAL",
          assignments: [
            { matchDayId: "match-1", playerId: "scorer-1", teamColor: "WHITE" },
            { matchDayId: "match-1", playerId: "assist-1", teamColor: "RED" }
          ]
        })
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
          matchType: "internal",
          games: [
            {
              sectionNo: 1,
              teamA: "white",
              teamB: "blue",
              scoreA: 1,
              scoreB: 0,
              rawText: "第一节 1:0 乙助攻甲",
              events: [
                {
                  type: "goal",
                  team: "white",
                  scorer: { rawName: "甲", playerId: "scorer-1", confidence: 1, candidates: [] },
                  assist: { rawName: "乙", playerId: "assist-1", confidence: 1, candidates: [] },
                  count: 1,
                  rawText: "乙助攻甲",
                  confidence: 1,
                  needsReview: false
                }
              ]
            },
            { sectionNo: 2, teamA: "white", teamB: "red", scoreA: 0, scoreB: 0, events: [], rawText: "" },
            { sectionNo: 3, teamA: "red", teamB: "blue", scoreA: 0, scoreB: 0, events: [], rawText: "" }
          ],
          awards: [],
          bonusPoints: [],
          uncertainItems: []
        },
        manualTeamRanks: [
          { teamColor: "WHITE", rank: 1 },
          { teamColor: "RED", rank: 2 },
          { teamColor: "BLUE", rank: 3 }
        ]
      })
    ).rejects.toMatchObject({ code: "MATCH_EVENT_CONFIRMATION_REQUIRED" });

    expect(formalDeletes.goalEvent).not.toHaveBeenCalled();
    expect(formalDeletes.internalGame).not.toHaveBeenCalled();
  });

});
