import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { MatchDayChanged } from "@/lib/server/event-confirmation";
import { resolveTrial, TrialResolutionError } from "@/lib/server/resolve-trial";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await resolveTrial(prisma, await request.json()));
  } catch (error) {
    if (error instanceof MatchDayChanged || error instanceof TrialResolutionError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error instanceof TrialResolutionError ? error.status : 409 });
    }
    return apiErrorResponse(error, "处理试训身份失败");
  }
}
