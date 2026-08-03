import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    player: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    playerAlias: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST as createPlayer } from "@/app/api/players/route";
import { PATCH as renamePlayer } from "@/app/api/players/[id]/route";
import { POST as createAlias } from "@/app/api/players/[id]/aliases/route";

const players = [
  {
    id: "player-a",
    name: "张三",
    aliases: [{ id: "alias-a", alias: "老张" }]
  },
  {
    id: "player-b",
    name: "李四",
    aliases: []
  }
];

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("player name route conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.player.findMany.mockResolvedValue(players);
    prismaMock.player.create.mockResolvedValue({
      id: "created-player",
      name: "老张",
      status: "ACTIVE",
      aliases: []
    });
    prismaMock.player.update.mockResolvedValue({
      ...players[0],
      name: "老张"
    });
    prismaMock.playerAlias.create.mockResolvedValue({
      id: "created-alias",
      playerId: "player-b",
      alias: "张 三",
      aliasType: "MANUAL"
    });
  });

  it("rejects a new player whose name is an existing alias", async () => {
    const response = await createPlayer(
      jsonRequest("http://localhost/api/players", "POST", {
        name: "老张",
        status: "ACTIVE"
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "球员名称“老张”已被球员“张三”用作别名“老张”"
    });
  });

  it("rejects a new player's initial alias when it matches an existing name", async () => {
    const response = await createPlayer(
      jsonRequest("http://localhost/api/players", "POST", {
        name: "王五",
        status: "ACTIVE",
        aliases: [{ alias: "张 三", aliasType: "MANUAL" }]
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "别名“张 三”与已有球员“张三”的名称重复"
    });
  });

  it("rejects renaming a player to one of their own aliases", async () => {
    const response = await renamePlayer(
      jsonRequest("http://localhost/api/players/player-a", "PATCH", { name: "老张" }),
      { params: { id: "player-a" } }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "球员名称“老张”已被球员“张三”用作别名“老张”"
    });
  });

  it("rejects an alias that matches an existing standard name", async () => {
    const response = await createAlias(
      jsonRequest("http://localhost/api/players/player-b/aliases", "POST", {
        alias: "张 三",
        aliasType: "MANUAL"
      }),
      { params: { id: "player-b" } }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "别名“张 三”与已有球员“张三”的名称重复"
    });
  });
});
