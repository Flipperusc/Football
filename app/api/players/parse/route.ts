import { NextResponse } from "next/server";
import { parsePlayerListWithAi, playerImportKey } from "@/lib/ai/player-list";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { playerListParseRequestSchema } from "@/lib/validations";

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
    const body = playerListParseRequestSchema.parse(await request.json());
    const [result, existingPlayers] = await Promise.all([
      parsePlayerListWithAi({ rawText: body.rawText }),
      prisma.player.findMany({ include: { aliases: true } })
    ]);

    const existingLookup = buildExistingLookup(existingPlayers);
    const players = result.parsed.players.map((player) => {
      const existing = existingLookup.get(playerImportKey(player.name));
      return {
        name: player.name,
        exists: Boolean(existing),
        existingPlayerId: existing?.id ?? null,
        existingName: existing?.name ?? null
      };
    });

    return NextResponse.json({
      parsed: { players },
      modelName: result.modelName,
      usedFallback: result.usedFallback
    });
  } catch (error) {
    return apiErrorResponse(error, "识别球员名单失败");
  }
}
