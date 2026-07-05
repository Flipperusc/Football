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
  const matchDay = await prisma.matchDay.create({
    data: {
      seasonId: body.seasonId,
      date: body.date,
      type: body.type,
      rawText: body.rawText,
      assignments: body.assignments.length
        ? {
            create: body.assignments
          }
        : undefined
    },
    include: {
      assignments: { include: { player: true } },
      season: true
    }
  });
  return NextResponse.json(matchDay, { status: 201 });
}
