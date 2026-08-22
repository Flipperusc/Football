import { describe, expect, it } from "vitest";
import { filterPlayersByName } from "@/lib/player-search";

const players = [
  { id: "p1", name: "张三", aliases: [{ alias: "老张" }] },
  { id: "p2", name: "BOBO", aliases: [{ alias: "波波" }] },
  { id: "p3", name: "李四", aliases: [] }
];

describe("filterPlayersByName", () => {
  it("matches a standard name by substring", () => {
    expect(filterPlayersByName(players, "张").map((player) => player.id)).toEqual(["p1"]);
  });

  it("matches a player alias", () => {
    expect(filterPlayersByName(players, "老张").map((player) => player.id)).toEqual(["p1"]);
  });

  it("ignores surrounding whitespace and English case", () => {
    expect(filterPlayersByName(players, "  bOb  ").map((player) => player.id)).toEqual(["p2"]);
  });

  it("returns all players for an empty query", () => {
    expect(filterPlayersByName(players, "   ")).toBe(players);
  });

  it("returns an empty list when no name or alias matches", () => {
    expect(filterPlayersByName(players, "王五")).toEqual([]);
  });
});
