import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seasonCreateSchema } from "@/lib/validations";
import { apiErrorResponse } from "@/lib/server/api-error";

export async function GET() {
  try {
    const seasons = await prisma.season.findMany({
      include: { _count: { select: { matchDays: true } } },
      orderBy: { startDate: "desc" }
    });
    return NextResponse.json(seasons);
  } catch (error) {
    return apiErrorResponse(error, "获取赛季失败");
  }
}

export async function POST(request: Request) {
  try {
    const body = seasonCreateSchema.parse(await request.json());
    const season = await prisma.season.create({ data: body });
    return NextResponse.json(season, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "创建赛季失败");
  }
}
