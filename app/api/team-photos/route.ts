import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminRequiredResponse, hasAdminSession } from "@/lib/server/admin-session";
import { apiErrorResponse } from "@/lib/server/api-error";
import { teamPhotoCreateSchema } from "@/lib/validations";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get("all") === "1";

    if (includeInactive && !hasAdminSession()) return adminRequiredResponse();

    const photos = await prisma.teamPhoto.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }]
    });
    return NextResponse.json(photos);
  } catch (error) {
    return apiErrorResponse(error, "获取球队风采照片失败");
  }
}

export async function POST(request: Request) {
  if (!hasAdminSession()) return adminRequiredResponse();

  try {
    const body = teamPhotoCreateSchema.parse(await request.json());
    const photo = await prisma.teamPhoto.create({ data: body });
    return NextResponse.json(photo, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "保存球队风采照片失败");
  }
}
