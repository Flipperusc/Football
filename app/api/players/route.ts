import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { playerCreateSchema } from "@/lib/validations";

export async function GET() {
  const players = await prisma.player.findMany({
    include: { aliases: true },
    orderBy: { name: "asc" }
  });
  return NextResponse.json(players);
}

export async function POST(request: Request) {
  const body = playerCreateSchema.parse(await request.json());
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
}
