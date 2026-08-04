import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  assertIdentityCandidatesAvailable,
  assertPlayerPayloadsAvailable,
  PlayerIdentityConflictError,
  translatePlayerIdentityWriteError
} from "@/lib/server/player-identities";

const existing = [
  { ownerId: "active", ownerName: "张三", value: "张三", kind: "PLAYER_NAME" as const },
  { ownerId: "inactive", ownerName: "李四", value: "老李", kind: "ALIAS" as const }
];

function expectConflict(run: () => void, code: string, value: string, message?: string) {
  expect(run).toThrowError(PlayerIdentityConflictError);

  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ status: 409, code, value });
    if (message) {
      expect((error as Error).message).toBe(message);
    } else {
      expect((error as Error).message).toMatch(/[一-鿿]/);
    }
  }
}

async function expectAsyncConflict(
  run: () => Promise<unknown>,
  code: string,
  value: string,
  message: string
) {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PlayerIdentityConflictError);
  expect(thrown).toMatchObject({ status: 409, code, value });
  expect((thrown as Error).message).toBe(message);
}

describe("player identity conflict validation", () => {
  it("rejects a name owned by an inactive player", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable(existing, [
          { ownerId: "new:0", ownerName: "张三", value: "张三", kind: "PLAYER_NAME" }
        ]),
      "PLAYER_NAME_CONFLICT",
      "张三"
    );
  });

  it("rejects a name that is another player's alias", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable(existing, [
          { ownerId: "new:0", ownerName: "老李", value: "老李", kind: "PLAYER_NAME" }
        ]),
      "PLAYER_NAME_USED_AS_ALIAS",
      "老李"
    );
  });

  it("rejects an alias that is another player's name", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable(existing, [
          { ownerId: "new:0", ownerName: "王五", value: "张三", kind: "ALIAS" }
        ]),
      "PLAYER_ALIAS_USED_AS_NAME",
      "张三"
    );
  });

  it("rejects an alias that is another player's alias", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable(existing, [
          { ownerId: "new:0", ownerName: "王五", value: "老李", kind: "ALIAS" }
        ]),
      "PLAYER_ALIAS_CONFLICT",
      "老李"
    );
  });

  it("rejects an alias equal to its own candidate name", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable([], [
          { ownerId: "new:0", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" },
          { ownerId: "new:0", ownerName: "王五", value: "王五", kind: "ALIAS" }
        ]),
      "PLAYER_ALIAS_EQUALS_NAME",
      "王五"
    );
  });

  it("rejects a repeated name inside one batch", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable([], [
          { ownerId: "new:0", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" },
          { ownerId: "new:1", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" }
        ]),
      "PLAYER_NAME_CONFLICT",
      "王五"
    );
  });

  it("does not mistake an earlier candidate name for a player's old stored name", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable([], [
          { ownerId: "new:0", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" },
          { ownerId: "new:0", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" }
        ]),
      "PLAYER_NAME_CONFLICT",
      "王五"
    );
  });

  it("rejects a repeated alias inside one batch", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable([], [
          { ownerId: "new:0", ownerName: "王五", value: "小王", kind: "ALIAS" },
          { ownerId: "new:1", ownerName: "赵六", value: "小王", kind: "ALIAS" }
        ]),
      "PLAYER_ALIAS_CONFLICT",
      "小王"
    );
  });

  it("reserves a player's aliases when that player is renamed", () => {
    expectConflict(
      () =>
        assertIdentityCandidatesAvailable(
          [
            { ownerId: "p1", ownerName: "旧名", value: "旧名", kind: "PLAYER_NAME" },
            { ownerId: "p1", ownerName: "旧名", value: "阿旧", kind: "ALIAS" }
          ],
          [{ ownerId: "p1", ownerName: "阿旧", value: "阿旧", kind: "PLAYER_NAME" }]
        ),
      "PLAYER_NAME_USED_AS_ALIAS",
      "阿旧"
    );
  });

  it("rejects an alias that equals the player's previous stored name during a rename", () => {
    const message = "球员别名不能与球员名称“张三”相同。";

    expectConflict(
      () =>
        assertIdentityCandidatesAvailable(
          [{ ownerId: "p1", ownerName: "张三", value: "张三", kind: "PLAYER_NAME" }],
          [
            { ownerId: "p1", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" },
            { ownerId: "p1", ownerName: "王五", value: "张三", kind: "ALIAS" }
          ]
        ),
      "PLAYER_ALIAS_EQUALS_NAME",
      "张三",
      message
    );
  });

  it("allows only a current owner's existing alias as an explicit idempotent no-op", () => {
    const records = [{ ownerId: "p1", ownerName: "王五", value: "小王", kind: "ALIAS" as const }];
    const candidates = [{ ownerId: "p1", ownerName: "王五", value: "小王", kind: "ALIAS" as const }];

    expectConflict(
      () => assertIdentityCandidatesAvailable(records, candidates),
      "PLAYER_ALIAS_CONFLICT",
      "小王"
    );
    expect(() =>
      assertIdentityCandidatesAvailable(records, candidates, { allowExistingAliasForSameOwner: true })
    ).not.toThrow();
  });

  it("accepts a non-conflicting payload", () => {
    expect(() =>
      assertIdentityCandidatesAvailable(existing, [
        { ownerId: "new:0", ownerName: "王五", value: "王五", kind: "PLAYER_NAME" },
        { ownerId: "new:0", ownerName: "王五", value: "小五", kind: "ALIAS" },
        { ownerId: "new:1", ownerName: "赵六", value: "赵六", kind: "PLAYER_NAME" }
      ])
    ).not.toThrow();
  });
});

describe("Prisma-backed player identity validation", () => {
  it("rejects a rename payload whose alias equals the player's previous stored name", async () => {
    const message = "球员别名不能与球员名称“张三”相同。";
    const db = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          { id: "p1", name: "张三", status: "ACTIVE" as const, aliases: [] }
        ])
      }
    };

    await expectAsyncConflict(
      () =>
        assertPlayerPayloadsAvailable(db, [
          { ownerId: "p1", name: "王五", aliases: ["张三"] }
        ]),
      "PLAYER_ALIAS_EQUALS_NAME",
      "张三",
      message
    );
  });

  it("keeps an inactive player's name reserved", async () => {
    const db = {
      player: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "inactive",
            name: "李四",
            status: "INACTIVE" as const,
            aliases: [{ alias: "老李" }]
          }
        ])
      }
    };

    await expect(
      assertPlayerPayloadsAvailable(db, [{ ownerId: "new:0", name: "李四" }])
    ).rejects.toMatchObject({
      status: 409,
      code: "PLAYER_NAME_CONFLICT",
      value: "李四"
    });
  });

  it("loads every player and alias including inactive players before validating the complete batch", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "inactive",
        name: "李四",
        status: "INACTIVE" as const,
        aliases: [{ alias: "老李" }]
      }
    ]);
    const db = { player: { findMany } };

    await expect(
      assertPlayerPayloadsAvailable(db, [
        { ownerId: "new:0", name: "王五", aliases: ["小王"] },
        { ownerId: "new:1", name: "赵六", aliases: ["老李"] }
      ])
    ).rejects.toMatchObject({
      status: 409,
      code: "PLAYER_ALIAS_CONFLICT",
      value: "老李"
    });

    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        status: true,
        aliases: { select: { alias: true } }
      }
    });
  });

  it("translates a late Prisma uniqueness error with the attempted value", () => {
    const lateError = new Prisma.PrismaClientKnownRequestError("unique constraint", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client
    });
    const candidates = [{ ownerId: "new:0", ownerName: "王五", value: "小王", kind: "ALIAS" as const }];

    expectConflict(
      () => translatePlayerIdentityWriteError(lateError, candidates),
      "PLAYER_ALIAS_CONFLICT",
      "小王"
    );
  });

  it("translates a trigger-origin uniqueness error with the attempted value", () => {
    const candidates = [{ ownerId: "new:0", ownerName: "王五", value: "王小五", kind: "PLAYER_NAME" as const }];

    expectConflict(
      () => translatePlayerIdentityWriteError(new Error("duplicate identity value raised by trigger"), candidates),
      "PLAYER_NAME_CONFLICT",
      "王小五"
    );
  });
});
