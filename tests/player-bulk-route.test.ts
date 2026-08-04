import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  storedPlayers: new Map<string, Record<string, unknown>>(),
  player: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUniqueOrThrow: vi.fn()
  },
  playerAlias: {
    create: vi.fn()
  },
  $transaction: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { POST } from "@/app/api/players/bulk/route";

function player(id: string, name: string) {
  return {
    id,
    name,
    jerseyNumber: null,
    position: null,
    avatarUrl: null,
    status: "ACTIVE" as const,
    createdAt: new Date("2026-08-04T00:00:00.000Z"),
    updatedAt: new Date("2026-08-04T00:00:00.000Z"),
    aliases: []
  };
}

function requestWithNames(names: string[]) {
  return new Request("http://localhost/api/players/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ players: names.map((name) => ({ name })) })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.storedPlayers.clear();
  db.player.findMany.mockResolvedValue([]);
  db.player.create.mockImplementation(async ({ data }: { data: { name: string } }) => {
    const created = player(`created-${db.storedPlayers.size + 1}`, data.name);
    db.storedPlayers.set(created.id, created);
    return created;
  });
  db.player.findUniqueOrThrow.mockImplementation(
    async ({ where }: { where: { id: string } }) => db.storedPlayers.get(where.id)
  );
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
});

describe("bulk player identity matching", () => {
  it("creates bobo when only the case-distinct BOBO already exists", async () => {
    db.player.findMany.mockResolvedValue([player("existing", "BOBO")]);

    const response = await POST(requestWithNames(["bobo"]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      created: [{ name: "bobo" }],
      skipped: []
    });
  });

  it("creates both A B and AB because internal whitespace is identity-significant", async () => {
    const response = await POST(requestWithNames(["A B", "AB"]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      created: [{ name: "A B" }, { name: "AB" }],
      skipped: []
    });
  });
});
