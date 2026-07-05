import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aliasCreateSchema } from "@/lib/validations";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = aliasCreateSchema.parse(await request.json());
  const alias = await prisma.playerAlias.create({
    data: {
      playerId: params.id,
      alias: body.alias,
      aliasType: body.aliasType
    }
  });
  return NextResponse.json(alias, { status: 201 });
}
