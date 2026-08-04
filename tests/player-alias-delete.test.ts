import { describe, expect, it, vi } from "vitest";
import { deletePlayerAlias } from "@/lib/server/player-identities";

function createDb(count: number) {
  const deleteMany = vi.fn().mockResolvedValue({ count });

  return {
    db: { playerAlias: { deleteMany } },
    deleteMany
  };
}

describe("deletePlayerAlias", () => {
  it("deletes an alias owned by the player", async () => {
    const { db, deleteMany } = createDb(1);

    await expect(deletePlayerAlias(db, "player-1", "alias-1")).resolves.toBe(true);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "alias-1", playerId: "player-1" }
    });
  });

  it("does not delete another player's alias", async () => {
    const { db, deleteMany } = createDb(0);

    await expect(deletePlayerAlias(db, "player-1", "alias-2")).resolves.toBe(false);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "alias-2", playerId: "player-1" }
    });
  });

  it("returns false when the alias is missing", async () => {
    const { db, deleteMany } = createDb(0);

    await expect(deletePlayerAlias(db, "player-1", "missing-alias")).resolves.toBe(false);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: "missing-alias", playerId: "player-1" }
    });
  });
});
