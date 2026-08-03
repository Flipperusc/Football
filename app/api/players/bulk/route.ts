import { NextResponse } from "next/server";
import { normalizePlayerNameForImport, playerImportKey } from "@/lib/ai/player-list";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  findPlayerNameConflict,
  formatPlayerNameConflict,
  type PlayerNameConflict,
  type PlayerNameSource
} from "@/lib/server/player-name-occupancy";
import { playerBulkCreateSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const body = playerBulkCreateSchema.parse(await request.json());
    const existingPlayers = await prisma.player.findMany({ include: { aliases: true } });
    const seenInput = new Set<string>();
    const acceptedSources: PlayerNameSource[] = [];
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

      const occupancySources: PlayerNameSource[] = [...existingPlayers, ...acceptedSources];
      const conflict = findPlayerNameConflict(name, occupancySources);
      if (conflict) {
        const isExistingPlayer = existingPlayers.some((player) => player.id === conflict.playerId);
        skipped.push({
          name,
          reason: formatPlayerNameConflict("球员名称", name, conflict),
          existingPlayerId: isExistingPlayer ? conflict.playerId : undefined,
          existingName: conflict.playerName
        });
        continue;
      }

      const pendingPlayer: PlayerNameSource = {
        id: `pending-player-${acceptedSources.length}`,
        name,
        aliases: []
      };
      let aliasConflict: PlayerNameConflict | null = null;
      let conflictingAliasName = "";
      for (const alias of row.aliases ?? []) {
        aliasConflict = findPlayerNameConflict(alias.alias, [...occupancySources, pendingPlayer]);
        if (aliasConflict) {
          conflictingAliasName = alias.alias;
          break;
        }
        pendingPlayer.aliases.push({ alias: alias.alias });
      }
      if (aliasConflict) {
        const isExistingPlayer = existingPlayers.some(
          (player) => player.id === aliasConflict.playerId
        );
        skipped.push({
          name,
          reason: formatPlayerNameConflict("别名", conflictingAliasName, aliasConflict),
          existingPlayerId: isExistingPlayer ? aliasConflict.playerId : undefined,
          existingName: aliasConflict.playerName
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
      acceptedSources.push(pendingPlayer);
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
