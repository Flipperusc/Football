import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  const body = playerUpdateSchema.parse(await request.json());
  const { aliases: _aliases, ...data } = body;
  const player = await prisma.player.update({
    where: { id: params.id },
    data,
    include: { aliases: true }
  });
  return NextResponse.json(player);
}
