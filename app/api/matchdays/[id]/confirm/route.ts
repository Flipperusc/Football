import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import {
  confirmMatchDay,
  TeamRankingConfirmationRequired
} from "@/lib/server/confirm-matchday";
import { PlayerIdentityConflictError } from "@/lib/server/player-identities";
import { confirmRequestSchema } from "@/lib/validations";
import { EventConfirmationRequired, MatchDayChanged } from "@/lib/server/event-confirmation";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = confirmRequestSchema.parse(await request.json());
    const confirmed = await confirmMatchDay(prisma, {
      matchDayId: params.id,
      parsedJson: body.parsedJson,
      eventConfirmationToken: body.eventConfirmationToken,
      matchDayVersion: body.matchDayVersion,
      teamAssignments: body.teamAssignments,
      manualTeamRanks: body.manualTeamRanks,
      saveAliases: body.saveAliases
    });
    return NextResponse.json(confirmed);
  } catch (error) {
    if (error instanceof EventConfirmationRequired) {
      return NextResponse.json({ code: error.code, message: error.message, exceptions: error.exceptions,
        confirmationToken: error.confirmationToken }, { status: error.status });
    }
    if (error instanceof MatchDayChanged || (error && typeof error === "object" && "code" in error && error.code === "P2034")) {
      return NextResponse.json({ code: "MATCH_DAY_CHANGED", message: "比赛已被其他操作更新，请重新加载后确认" }, { status: 409 });
    }
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
