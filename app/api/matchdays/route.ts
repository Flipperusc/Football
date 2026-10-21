import { assertParticipantCorrections } from "@/lib/server/participant-corrections";
import { apiErrorResponse } from "@/lib/server/api-error";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchDayCreateSchema } from "@/lib/validations";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const seasonId = url.searchParams.get("seasonId") ?? undefined;
  const type = url.searchParams.get("type") as "INTERNAL" | "EXTERNAL" | null;
  const matchDays = await prisma.matchDay.findMany({
    where: {
      seasonId,
      type: type ?? undefined
    },
    include: {
      trialPlayers: true,
      season: true,
      assignments: { include: { player: true } },
      teamResults: true,
      _count: { select: { goalEvents: true } }
    },
    orderBy: { date: "desc" }
  });
  return NextResponse.json(matchDays);
}

export async function POST(request: Request) {
  try {
  const body = matchDayCreateSchema.parse(await request.json());
  if (
    body.type === "INTERNAL" &&
    body.assignments.filter((assignment) => assignment.teamColor !== "EXTERNAL").length === 0
  ) {
    return NextResponse.json(
      { message: "队内赛必须先填写红队、蓝队、白队球员，才能创建比赛日并分配名次积分。" },
      { status: 400 }
    );
  }
  if (body.type === "EXTERNAL" && body.trialPlayers.length) return NextResponse.json({ message: "队外赛不支持试训身份" }, { status: 400 });
  await assertParticipantCorrections(prisma, body.participantCorrections, body.assignments, body.type);
  const matchDay = await prisma.matchDay.create({
    data: {
      seasonId: body.seasonId,
      date: body.date,
      type: body.type,
      rawText: body.rawText,
      participantCorrections: body.participantCorrections,
      trialPlayers: { create: body.trialPlayers },
      assignments: body.assignments.length
        ? {
            create: body.assignments
          }
        : undefined
    },
    include: {
      assignments: { include: { player: true } },
      trialPlayers: true,
      season: true
    }
  });
  return NextResponse.json(matchDay, { status: 201 });
  } catch (error) { return apiErrorResponse(error, "创建比赛日失败"); }
}
