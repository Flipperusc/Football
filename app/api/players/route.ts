import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  assertPlayerPayloadsAvailable,
  translatePlayerIdentityWriteError,
  type IdentityCandidate
} from "@/lib/server/player-identities";
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
    const { aliases, ...player } = body;
    const created = await prisma.$transaction(async (tx) => {
      await assertPlayerPayloadsAvailable(tx, [
        {
          ownerId: "new:0",
          name: body.name,
          aliases: aliases?.map((item) => item.alias) ?? []
        }
      ]);

      const nameCandidate: IdentityCandidate = {
        ownerId: "new:0",
        ownerName: body.name,
        value: body.name,
        kind: "PLAYER_NAME"
      };
      const createdPlayer = await tx.player.create({ data: player }).catch((error) =>
        translatePlayerIdentityWriteError(error, [nameCandidate])
      );

      for (const item of aliases ?? []) {
        const aliasCandidate: IdentityCandidate = {
          ownerId: createdPlayer.id,
          ownerName: body.name,
          value: item.alias,
          kind: "ALIAS"
        };
        await tx.playerAlias
          .create({
            data: {
              playerId: createdPlayer.id,
              alias: item.alias,
              aliasType: item.aliasType
            }
          })
          .catch((error) => translatePlayerIdentityWriteError(error, [aliasCandidate]));
      }

      return tx.player.findUniqueOrThrow({
        where: { id: createdPlayer.id },
        include: { aliases: true }
      });
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "创建球员失败");
  }
}
