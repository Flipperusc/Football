import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseMatchWithAi } from "@/lib/ai/deepseek";
import { parseRequestSchema } from "@/lib/validations";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = parseRequestSchema.parse(await request.json());
  const players = await prisma.player.findMany({
    include: { aliases: true },
    orderBy: { name: "asc" }
  });

  try {
    const parsed = await parseMatchWithAi({
      rawText: body.rawText,
      matchType: body.matchType,
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        aliases: player.aliases.map((alias) => ({
          alias: alias.alias,
          aliasType: alias.aliasType
        }))
      })),
      teamAssignments: body.teamAssignments
    });

    await prisma.matchDay.update({
      where: { id: params.id },
      data: {
        rawText: body.rawText,
        parseStatus: "PARSED"
      }
    });
    await prisma.matchParseResult.create({
      data: {
        matchDayId: params.id,
        rawText: body.rawText,
        parsedJson: parsed.parsed,
        modelName: parsed.modelName,
        status:
          parsed.parsed.uncertainItems.length > 0 || parsed.usedFallback ? "NEEDS_REVIEW" : "SUCCESS"
      }
    });

    return NextResponse.json(parsed);
  } catch (error) {
    await prisma.matchParseResult.create({
      data: {
        matchDayId: params.id,
        rawText: body.rawText,
        parsedJson: {},
        modelName: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    await prisma.matchDay.update({
      where: { id: params.id },
      data: { parseStatus: "FAILED" }
    });
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "AI parse failed" },
      { status: 422 }
    );
  }
}
