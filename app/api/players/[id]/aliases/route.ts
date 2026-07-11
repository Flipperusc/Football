import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { aliasCreateSchema } from "@/lib/validations";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = aliasCreateSchema.parse(await request.json());
    const alias = await prisma.playerAlias.create({
      data: {
        playerId: params.id,
        alias: body.alias,
        aliasType: body.aliasType
      }
    });
    return NextResponse.json(alias, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "该球员已存在这个别名" }, { status: 409 });
    }
    return apiErrorResponse(error, "保存球员别名失败");
  }
}
