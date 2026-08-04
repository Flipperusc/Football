import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { deletePlayerAlias } from "@/lib/server/player-identities";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; aliasId: string } }
) {
  try {
    const deleted = await deletePlayerAlias(prisma, params.id, params.aliasId);
    if (!deleted) {
      return NextResponse.json({ message: "别名不存在" }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error, "删除别名失败");
  }
}
