import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  confirmMatchDay,
  TeamRankingConfirmationRequired
} from "@/lib/server/confirm-matchday";
import { PlayerIdentityConflictError } from "@/lib/server/player-identities";
import { confirmRequestSchema } from "@/lib/validations";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = confirmRequestSchema.parse(await request.json());
  try {
    const confirmed = await confirmMatchDay(prisma, {
      matchDayId: params.id,
      parsedJson: body.parsedJson,
      teamAssignments: body.teamAssignments,
      manualTeamRanks: body.manualTeamRanks,
      saveAliases: body.saveAliases
    });
    return NextResponse.json(confirmed);
  } catch (error) {
    if (error instanceof TeamRankingConfirmationRequired) {
      return NextResponse.json(
        {
          code: error.code,
          message: error.message,
          teamResults: error.teamResults
        },
        { status: error.status }
      );
    }
    if (error instanceof PlayerIdentityConflictError) {
      return apiErrorResponse(error);
    }
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Confirm failed" },
      { status: 422 }
    );
  }
}
