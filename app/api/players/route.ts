import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  findPlayerNameConflict,
  formatPlayerNameConflict,
  type PlayerNameSource
} from "@/lib/server/player-name-occupancy";
import { playerCreateSchema } from "@/lib/validations";

export async function GET() {
  const players = await prisma.player.findMany({
    include: { aliases: true },
    orderBy: { name: "asc" }
  });
  return NextResponse.json(players);
}

export async function POST(request: Request) {
  try {
    const body = playerCreateSchema.parse(await request.json());
    const existingPlayers = await prisma.player.findMany({
      select: {
        id: true,
        name: true,
        aliases: { select: { id: true, alias: true } }
      }
    });
    const conflict = findPlayerNameConflict(body.name, existingPlayers);
    if (conflict) {
      return NextResponse.json(
        { message: formatPlayerNameConflict("球员名称", body.name, conflict) },
        { status: 409 }
      );
    }

    const pendingPlayer: PlayerNameSource = {
      id: "pending-player",
      name: body.name,
      aliases: []
    };
    const occupancySources: PlayerNameSource[] = [...existingPlayers, pendingPlayer];
    for (const alias of body.aliases ?? []) {
      const aliasConflict = findPlayerNameConflict(alias.alias, occupancySources);
      if (aliasConflict) {
        return NextResponse.json(
          { message: formatPlayerNameConflict("别名", alias.alias, aliasConflict) },
          { status: 409 }
        );
      }
      pendingPlayer.aliases.push({ alias: alias.alias });
    }

    const { aliases, ...player } = body;
    const created = await prisma.player.create({
      data: {
        ...player,
        aliases: aliases?.length
          ? {
              create: aliases
            }
          : undefined
      },
      include: { aliases: true }
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "新增球员失败");
  }
}
