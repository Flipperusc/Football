import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminRequiredResponse, hasAdminSession } from "@/lib/server/admin-session";
import { apiErrorResponse } from "@/lib/server/api-error";
import { teamSettingUpdateSchema } from "@/lib/validations";

const TEAM_SETTING_ID = "default";

export async function GET() {
  if (!hasAdminSession()) return adminRequiredResponse();

  try {
    const settings = await prisma.teamSetting.findUnique({ where: { id: TEAM_SETTING_ID } });
    return NextResponse.json(settings ?? { id: TEAM_SETTING_ID, logoUrl: null });
  } catch (error) {
    return apiErrorResponse(error, "获取球队设置失败");
  }
}

export async function PATCH(request: Request) {
  if (!hasAdminSession()) return adminRequiredResponse();

  try {
    const body = teamSettingUpdateSchema.parse(await request.json());
    const settings = await prisma.teamSetting.upsert({
      where: { id: TEAM_SETTING_ID },
      create: { id: TEAM_SETTING_ID, ...body },
      update: body
    });
    return NextResponse.json(settings);
  } catch (error) {
    return apiErrorResponse(error, "保存球队设置失败");
  }
}
