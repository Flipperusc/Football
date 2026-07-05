import { NextResponse } from "next/server";
import { parseRosterWithAi } from "@/lib/ai/roster";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { rosterParseRequestSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const body = rosterParseRequestSchema.parse(await request.json());
    const players = await prisma.player.findMany({
      include: { aliases: true },
      orderBy: { name: "asc" }
    });

    const parsed = await parseRosterWithAi({
      rawText: body.rawText,
      matchType: body.matchType,
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        aliases: player.aliases.map((alias) => ({
          alias: alias.alias,
          aliasType: alias.aliasType
        }))
      }))
    });

    return NextResponse.json(parsed);
  } catch (error) {
    return apiErrorResponse(error, "识别阵容失败");
  }
}
