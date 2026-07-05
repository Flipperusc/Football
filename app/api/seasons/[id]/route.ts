import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seasonUpdateSchema } from "@/lib/validations";
import { apiErrorResponse } from "@/lib/server/api-error";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const season = await prisma.season.findUnique({
      where: { id: params.id },
      include: { matchDays: true }
    });
    if (!season) return NextResponse.json({ message: "Season not found" }, { status: 404 });
    return NextResponse.json(season);
  } catch (error) {
    return apiErrorResponse(error, "获取赛季失败");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = seasonUpdateSchema.parse(await request.json());
    const season = await prisma.season.update({
      where: { id: params.id },
      data: body
    });
    return NextResponse.json(season);
  } catch (error) {
    return apiErrorResponse(error, "更新赛季失败");
  }
}
