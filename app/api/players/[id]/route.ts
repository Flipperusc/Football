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

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const player = await prisma.player.findUnique({
      where: { id: params.id },
      select: {
        name: true,
        _count: {
          select: {
            assignments: true,
            goals: true,
            assists: true,
            points: true,
            awards: true,
            statAdjustments: true
          }
        }
      }
    });

    if (!player) {
      return NextResponse.json({ message: "球员不存在" }, { status: 404 });
    }

    const hasRecordedData = Object.values(player._count).some((count) => count > 0);
    if (hasRecordedData) {
      return NextResponse.json(
        { message: `球员“${player.name}”已有比赛或人工数据记录，不能删除；如已离队，请将状态改为停用。` },
        { status: 409 }
      );
    }

    await prisma.player.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "删除球员失败");
  }
}
