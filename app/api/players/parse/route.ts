import { NextResponse } from "next/server";
import { parsePlayerListWithAi, playerImportKey } from "@/lib/ai/player-list";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { buildPlayerNameOccupancy } from "@/lib/server/player-name-occupancy";
import { playerListParseRequestSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const body = playerListParseRequestSchema.parse(await request.json());
    const [result, existingPlayers] = await Promise.all([
      parsePlayerListWithAi({ rawText: body.rawText }),
      prisma.player.findMany({ include: { aliases: true } })
    ]);

    const existingLookup = buildPlayerNameOccupancy(existingPlayers);
    const players = result.parsed.players.map((player) => {
      const existing = existingLookup.get(playerImportKey(player.name));
      return {
        name: player.name,
        exists: Boolean(existing),
        existingPlayerId: existing?.playerId ?? null,
        existingName: existing?.playerName ?? null
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
