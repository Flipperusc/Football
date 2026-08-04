import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  assertPlayerPayloadsAvailable,
  translatePlayerIdentityWriteError,
  type IdentityCandidate
} from "@/lib/server/player-identities";
import { playerUpdateSchema } from "@/lib/validations";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const player = await prisma.player.findUnique({
    where: { id: params.id },
    include: { aliases: true }
  });
  if (!player) return NextResponse.json({ message: "Player not found" }, { status: 404 });
  return NextResponse.json(player);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = playerUpdateSchema.parse(await request.json());
    const { aliases: _aliases, ...data } = body;
    const candidates: IdentityCandidate[] = body.name
      ? [
          {
            ownerId: params.id,
            ownerName: body.name,
            value: body.name,
            kind: "PLAYER_NAME"
          }
        ]
      : [];

    if (body.name) {
      await assertPlayerPayloadsAvailable(prisma, [{ ownerId: params.id, name: body.name }]);
    }

    const player = await prisma.player
      .update({
        where: { id: params.id },
        data,
        include: { aliases: true }
      })
      .catch((error) => translatePlayerIdentityWriteError(error, candidates));
    return NextResponse.json(player);
  } catch (error) {
    return apiErrorResponse(error, "更新球员失败");
  }
}
