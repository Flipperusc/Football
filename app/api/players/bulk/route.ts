import { NextResponse } from "next/server";
import { normalizePlayerNameForImport, playerImportKey } from "@/lib/ai/player-list";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  assertIdentityCandidatesAvailable,
  assertPlayerPayloadsAvailable,
  PlayerIdentityConflictError,
  translatePlayerIdentityWriteError,
  type IdentityCandidate,
  type IdentityRecord
} from "@/lib/server/player-identities";
import { playerBulkCreateSchema } from "@/lib/validations";

type CreateRow = {
  ownerId: string;
  name: string;
  jerseyNumber?: number | null;
  position?: string | null;
  status: "ACTIVE" | "INACTIVE";
  aliases?: { alias: string; aliasType: "NICKNAME" | "TYPO" | "SHORT_NAME" | "MANUAL" }[];
};

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

function identityCandidatesForRow(row: CreateRow): IdentityCandidate[] {
  return [
    {
      ownerId: row.ownerId,
      ownerName: row.name,
      value: row.name,
      kind: "PLAYER_NAME"
    },
    ...(row.aliases ?? []).map((item) => ({
      ownerId: row.ownerId,
      ownerName: row.name,
      value: item.alias,
      kind: "ALIAS" as const
    }))
  ];
}

export async function POST(request: Request) {
  try {
    const body = playerBulkCreateSchema.parse(await request.json());
    const existingPlayers = await prisma.player.findMany({ include: { aliases: true } });
    const existingLookup = buildExistingLookup(existingPlayers);
    const seenInput = new Set<string>();
    const skipped: { name: string; reason: string; existingPlayerId?: string; existingName?: string }[] = [];
    const candidateRows: CreateRow[] = [];

    for (const [index, row] of body.players.entries()) {
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

      candidateRows.push({
        ownerId: `new:${index}`,
        name,
        jerseyNumber: row.jerseyNumber ?? null,
        position: row.position ?? null,
        status: row.status ?? "ACTIVE",
        aliases: row.aliases
      });
    }

    const existingIdentities: IdentityRecord[] = existingPlayers.flatMap((player) => [
      {
        ownerId: player.id,
        ownerName: player.name,
        value: player.name,
        kind: "PLAYER_NAME" as const
      },
      ...player.aliases.map((alias) => ({
        ownerId: player.id,
        ownerName: player.name,
        value: alias.alias,
        kind: "ALIAS" as const
      }))
    ]);
    const createRows: CreateRow[] = [];
    for (const row of candidateRows) {
      try {
        assertIdentityCandidatesAvailable(existingIdentities, [
          ...createRows.flatMap(identityCandidatesForRow),
          ...identityCandidatesForRow(row)
        ]);
        createRows.push(row);
      } catch (error) {
        if (!(error instanceof PlayerIdentityConflictError)) throw error;
        skipped.push({ name: row.name, reason: error.message });
      }
    }

    if (createRows.length > 0) {
      await assertPlayerPayloadsAvailable(
        prisma,
        createRows.map((row) => ({
          ownerId: row.ownerId,
          name: row.name,
          aliases: row.aliases?.map((item) => item.alias) ?? []
        }))
      );
    }

    const created = createRows.length
      ? await prisma.$transaction(async (tx) => {
          const players = [];
          for (const row of createRows) {
            const [nameCandidate, ...aliasCandidates] = identityCandidatesForRow(row);
            const createdPlayer = await tx.player
              .create({
                data: {
                  name: row.name,
                  jerseyNumber: row.jerseyNumber,
                  position: row.position,
                  status: row.status
                }
              })
              .catch((error) => translatePlayerIdentityWriteError(error, [nameCandidate]));

            for (const [index, alias] of (row.aliases ?? []).entries()) {
              await tx.playerAlias
                .create({
                  data: {
                    playerId: createdPlayer.id,
                    alias: alias.alias,
                    aliasType: alias.aliasType
                  }
                })
                .catch((error) =>
                  translatePlayerIdentityWriteError(error, [
                    { ...aliasCandidates[index], ownerId: createdPlayer.id }
                  ])
                );
            }

            players.push(
              await tx.player.findUniqueOrThrow({
                where: { id: createdPlayer.id },
                include: { aliases: true }
              })
            );
          }
          return players;
        })
      : [];

    return NextResponse.json({ created, skipped });
  } catch (error) {
    return apiErrorResponse(error, "批量导入球员失败");
  }
}
