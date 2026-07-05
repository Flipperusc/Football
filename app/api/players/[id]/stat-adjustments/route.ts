import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { playerStatAdjustmentCreateSchema } from "@/lib/validations";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const seasonId = searchParams.get("seasonId") ?? undefined;

  const adjustments = await prisma.playerStatAdjustment.findMany({
    where: {
      playerId: params.id,
      seasonId
    },
    include: {
      season: true,
      player: true
    },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json(adjustments);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = playerStatAdjustmentCreateSchema.parse(await request.json());
  const player = await prisma.player.findUnique({ where: { id: params.id } });
  if (!player) return NextResponse.json({ message: "Player not found" }, { status: 404 });

  const adjustment = await prisma.playerStatAdjustment.create({
    data: {
      playerId: params.id,
      seasonId: body.seasonId,
      metric: body.metric,
      operation: body.operation,
      value: body.value,
      reason: body.reason
    },
    include: {
      season: true,
      player: true
    }
  });

  return NextResponse.json(adjustment, { status: 201 });
}
