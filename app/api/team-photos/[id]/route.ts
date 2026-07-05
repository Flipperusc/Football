import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminRequiredResponse, hasAdminSession } from "@/lib/server/admin-session";
import { apiErrorResponse } from "@/lib/server/api-error";
import { teamPhotoUpdateSchema } from "@/lib/validations";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!hasAdminSession()) return adminRequiredResponse();

  try {
    const body = teamPhotoUpdateSchema.parse(await request.json());
    const photo = await prisma.teamPhoto.update({
      where: { id: params.id },
      data: body
    });
    return NextResponse.json(photo);
  } catch (error) {
    return apiErrorResponse(error, "更新球队风采照片失败");
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!hasAdminSession()) return adminRequiredResponse();

  try {
    await prisma.teamPhoto.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "删除球队风采照片失败");
  }
}
