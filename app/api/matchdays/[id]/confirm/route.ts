import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { confirmMatchDay } from "@/lib/server/confirm-matchday";
import { confirmRequestSchema } from "@/lib/validations";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = confirmRequestSchema.parse(await request.json());
  try {
    const confirmed = await confirmMatchDay(prisma, {
      matchDayId: params.id,
      parsedJson: body.parsedJson,
      teamAssignments: body.teamAssignments,
      saveAliases: body.saveAliases
    });
    return NextResponse.json(confirmed);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Confirm failed" },
      { status: 422 }
    );
  }
}
