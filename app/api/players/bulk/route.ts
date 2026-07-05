import { NextResponse } from "next/server";
import { normalizePlayerNameForImport, playerImportKey } from "@/lib/ai/player-list";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { playerBulkCreateSchema } from "@/lib/validations";

function buildExistingLookup(
  players: {
    id: string;
    name: string;
    aliases: { alias: string }[];
  }[]
) {
  const lookup = new Map<string, { id: string; name: string }>();
  for (const player of players) {
    const playerKey = playerImportKey(player.name);
    if (playerKey) lookup.set(playerKey, { id: player.id, name: player.name });
    for (const alias of player.aliases) {
      const aliasKey = playerImportKey(alias.alias);
      if (aliasKey) lookup.set(aliasKey, { id: player.id, name: player.name });
    }
  }
  return lookup;
}

export async function POST(request: Request) {
  try {
    const body = playerBulkCreateSchema.parse(await request.json());
    const existingPlayers = await prisma.player.findMany({ include: { aliases: true } });
    const existingLookup = buildExistingLookup(existingPlayers);
    const seenInput = new Set<string>();
    const skipped: { name: string; reason: string; existingPlayerId?: string; existingName?: string }[] = [];
    const createRows: {
      name: string;
      jerseyNumber?: number | null;
      position?: string | null;
      status: "ACTIVE" | "INACTIVE";
      aliases?: { alias: string; aliasType: "NICKNAME" | "TYPO" | "SHORT_NAME" | "MANUAL" }[];
    }[] = [];

    for (const row of body.players) {
      const name = normalizePlayerNameForImport(row.name);
      const key = playerImportKey(name);
      if (!name || !key) continue;

      if (seenInput.has(key)) {
        skipped.push({ name, reason: "名单中重复" });
        continue;
      }
      seenInput.add(key);

      const existing = existingLookup.get(key);
      if (existing) {
        skipped.push({
          name,
          reason: "球员已存在",
          existingPlayerId: existing.id,
          existingName: existing.name
        });
        continue;
      }

      createRows.push({
        name,
        jerseyNumber: row.jerseyNumber ?? null,
        position: row.position ?? null,
        status: row.status ?? "ACTIVE",
        aliases: row.aliases
      });
    }

    const created = createRows.length
      ? await prisma.$transaction(
          createRows.map((row) =>
            prisma.player.create({
              data: {
                name: row.name,
                jerseyNumber: row.jerseyNumber,
                position: row.position,
                status: row.status,
                aliases: row.aliases?.length ? { create: row.aliases } : undefined
              },
              include: { aliases: true }
            })
          )
        )
      : [];

    return NextResponse.json({ created, skipped });
  } catch (error) {
    return apiErrorResponse(error, "批量导入球员失败");
  }
}
