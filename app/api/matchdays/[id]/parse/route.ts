import { NextResponse } from "next/server";
import { DeepSeekError, getDeepSeekModel } from "@/lib/ai/deepseek-client";
import { parseMatchWithAi } from "@/lib/ai/deepseek";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { parseRequestSchema } from "@/lib/validations";

type MatchType = "INTERNAL" | "EXTERNAL";

class MatchParseConflictError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "MatchParseConflictError";
    this.code = code;
  }
}

function matchStateResponse(message: string, code: string, status: 404 | 409) {
  return NextResponse.json({ message, code }, { status });
}

function aiParseErrorResponse(error: DeepSeekError) {
  const message =
    error.code === "AI_TIMEOUT"
      ? "DeepSeek 解析等待超时。比赛信息已经保存，请点击“重新解析”再次尝试。"
      : `${error.message} 比赛信息已经保存，可稍后点击“重新解析”再次尝试。`;

  return NextResponse.json(
    {
      message,
      code: error.code
    },
    { status: error.status }
  );
}

function safeFailureMessage(error: unknown) {
  return error instanceof DeepSeekError ? error.message : "比赛解析失败";
}

async function recordFailedParse({
  matchDayId,
  matchType,
  rawText,
  error
}: {
  matchDayId: string;
  matchType: MatchType;
  rawText: string;
  error: unknown;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.matchDay.updateMany({
      where: { id: matchDayId, type: matchType },
      data: { rawText, parseStatus: "FAILED" }
    });
    if (updated.count === 0) return false;

    await tx.matchParseResult.create({
      data: {
        matchDayId,
        rawText,
        parsedJson: {},
        modelName: getDeepSeekModel(),
        status: "FAILED",
        errorMessage: safeFailureMessage(error)
      }
    });
    return true;
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body;
  try {
    body = parseRequestSchema.parse(await request.json());
  } catch (error) {
    return apiErrorResponse(error, "解析请求格式不正确");
  }

  let matchDay;
  try {
    matchDay = await prisma.matchDay.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        type: true,
        assignments: {
          select: { playerId: true, teamColor: true, role: true, isCaptain: true }
        }
      }
    });
  } catch (error) {
    return apiErrorResponse(error, "读取比赛信息失败");
  }

  if (!matchDay) {
    return matchStateResponse("比赛记录不存在或已被删除。", "MATCH_DAY_NOT_FOUND", 404);
  }
  if (matchDay.type !== body.matchType) {
    return matchStateResponse(
      "比赛类型与解析请求不一致，请返回录入页面检查。",
      "MATCH_TYPE_MISMATCH",
      409
    );
  }

  let parsed;
  try {
    const players = await prisma.player.findMany({
      include: { aliases: true },
      orderBy: { name: "asc" }
    });

    parsed = await parseMatchWithAi({
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
      teamAssignments: matchDay.assignments
    });
  } catch (error) {
    let parentStillExists = true;
    try {
      parentStillExists = await recordFailedParse({
        matchDayId: params.id,
        matchType: body.matchType,
        rawText: body.rawText,
        error
      });
    } catch (recordError) {
      console.error("[match-parse]", {
        event: "failed-result-write",
        errorType: recordError instanceof Error ? recordError.name : "UnknownError"
      });
    }

    if (!parentStillExists) {
      return matchStateResponse(
        "比赛在解析过程中已被删除，解析结果未保存。",
        "MATCH_DAY_DELETED_DURING_PARSE",
        409
      );
    }
    if (error instanceof DeepSeekError) return aiParseErrorResponse(error);
    return apiErrorResponse(error, "解析比赛失败");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.matchDay.updateMany({
        where: { id: params.id, type: body.matchType },
        data: {
          rawText: body.rawText,
          parseStatus: "PARSED"
        }
      });
      if (updated.count === 0) {
        throw new MatchParseConflictError(
          "比赛在解析过程中已被删除，解析结果未保存。",
          "MATCH_DAY_DELETED_DURING_PARSE"
        );
      }

      await tx.matchParseResult.create({
        data: {
          matchDayId: params.id,
          rawText: body.rawText,
          parsedJson: parsed.parsed,
          modelName: parsed.modelName,
          status:
            parsed.parsed.uncertainItems.length > 0 || parsed.usedFallback
              ? "NEEDS_REVIEW"
              : "SUCCESS"
        }
      });
    });
  } catch (error) {
    if (error instanceof MatchParseConflictError) {
      return matchStateResponse(error.message, error.code, 409);
    }
    return apiErrorResponse(error, "保存解析结果失败");
  }

  return NextResponse.json(parsed);
}
