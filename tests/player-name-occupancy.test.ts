import { describe, expect, it } from "vitest";
import {
  buildPlayerNameOccupancy,
  findPlayerNameConflict,
  formatPlayerNameConflict
} from "@/lib/server/player-name-occupancy";

const players = [
  {
    id: "player-a",
    name: "张三",
    aliases: [{ id: "alias-a", alias: "老张" }]
  },
  {
    id: "player-b",
    name: "BOBO",
    aliases: [{ id: "alias-b", alias: "波波" }]
  }
];

describe("player name occupancy", () => {
  it("finds an occupied standard name after normalization", () => {
    expect(findPlayerNameConflict("ｂｏｂｏ", players)).toEqual({
      kind: "PLAYER_NAME",
      playerId: "player-b",
      playerName: "BOBO",
      value: "BOBO"
    });
  });

  it("finds an occupied alias after whitespace normalization", () => {
    expect(findPlayerNameConflict("老 张", players)).toEqual({
      kind: "ALIAS",
      playerId: "player-a",
      playerName: "张三",
      value: "老张",
      aliasId: "alias-a"
    });
  });

  it("excludes only the current standard name when renaming", () => {
    expect(
      findPlayerNameConflict("张三", players, {
        excludeStandardNameOfPlayerId: "player-a"
      })
    ).toBeNull();

    expect(
      findPlayerNameConflict("老张", players, {
        excludeStandardNameOfPlayerId: "player-a"
      })?.kind
    ).toBe("ALIAS");
  });

  it("returns no conflict for an unused name", () => {
    expect(findPlayerNameConflict("李四", players)).toBeNull();
  });

  it("formats messages with the conflict source and owner", () => {
    const aliasConflict = findPlayerNameConflict("老张", players);
    const nameConflict = findPlayerNameConflict("bobo", players);

    expect(aliasConflict).not.toBeNull();
    expect(nameConflict).not.toBeNull();
    expect(formatPlayerNameConflict("球员名称", "老张", aliasConflict!)).toBe(
      "球员名称“老张”已被球员“张三”用作别名“老张”"
    );
    expect(formatPlayerNameConflict("别名", "bobo", nameConflict!)).toBe(
      "别名“bobo”与已有球员“BOBO”的名称重复"
    );
  });

  it("keeps standard-name occupancy ahead of aliases with the same normalized key", () => {
    const lookup = buildPlayerNameOccupancy([
      ...players,
      {
        id: "player-c",
        name: "李四",
        aliases: [{ id: "alias-c", alias: "BOBO" }]
      }
    ]);

    expect(lookup.get("bobo")).toEqual({
      kind: "PLAYER_NAME",
      playerId: "player-b",
      playerName: "BOBO",
      value: "BOBO"
    });
  });
});
