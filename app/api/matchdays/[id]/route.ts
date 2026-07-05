import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchDayUpdateSchema } from "@/lib/validations";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const matchDay = await prisma.matchDay.findUnique({
    where: { id: params.id },
    include: {
      season: true,
      assignments: { include: { player: true } },
      internalGames: { include: { goals: true }, orderBy: { sectionNo: "asc" } },
      goalEvents: { include: { scorer: true, assistPlayer: true } },
      teamResults: true,
      playerPoints: true,
      awards: true,
      parseResults: { orderBy: { createdAt: "desc" }, take: 5 }
    }
  });
  if (!matchDay) return NextResponse.json({ message: "Match day not found" }, { status: 404 });
  return NextResponse.json(matchDay);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = matchDayUpdateSchema.parse(await request.json());
  const { assignments, ...data } = body;
  const matchDay = await prisma.$transaction(async (tx) => {
    if (assignments) {
      await tx.teamAssignment.deleteMany({ where: { matchDayId: params.id } });
      if (assignments.length) {
        await tx.teamAssignment.createMany({
          data: assignments.map((assignment) => ({
            matchDayId: params.id,
            ...assignment
          })),
          skipDuplicates: true
        });
      }
    }

    return tx.matchDay.update({
      where: { id: params.id },
      data,
      include: {
        assignments: { include: { player: true } },
        season: true
      }
    });
  });
  return NextResponse.json(matchDay);
}
