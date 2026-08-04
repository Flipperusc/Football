import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  assertPlayerPayloadsAvailable,
  translatePlayerIdentityWriteError,
  type IdentityCandidate
} from "@/lib/server/player-identities";
import { aliasCreateSchema } from "@/lib/validations";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = aliasCreateSchema.parse(await request.json());
    const owner = await prisma.player.findUnique({
      where: { id: params.id },
      select: { name: true }
    });
    if (!owner) {
      return NextResponse.json({ message: "Player not found" }, { status: 404 });
    }

    await assertPlayerPayloadsAvailable(prisma, [
      { ownerId: params.id, name: owner.name, aliases: [body.alias] }
    ]);
    const candidate: IdentityCandidate = {
      ownerId: params.id,
      ownerName: owner.name,
      value: body.alias,
      kind: "ALIAS"
    };
    const alias = await prisma.playerAlias
      .create({
        data: {
          playerId: params.id,
          alias: body.alias,
          aliasType: body.aliasType
        }
      })
      .catch((error) => translatePlayerIdentityWriteError(error, [candidate]));
    return NextResponse.json(alias, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "创建球员别名失败");
  }
}
