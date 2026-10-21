import { applyParticipantCorrections } from "@/lib/ai/participant-corrections";
import { randomUUID } from "node:crypto";
import { assignAutomaticTrials } from "@/lib/ai/automatic-trials";
import { preserveConfirmedParticipants, confirmedParticipantRecognition } from "@/lib/ai/preserve-confirmed-participants";
import { NextResponse } from "next/server";
import { DeepSeekError, getDeepSeekModel } from "@/lib/ai/deepseek-client";
import { parseMatchWithAi } from "@/lib/ai/deepseek";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";
import { parseRequestSchema, teamAssignmentInputSchema, trialPlayersInputSchema, participantCorrectionsSchema } from "@/lib/validations";

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
  error,
  updatedAt,
  confirmed
}: {
  matchDayId: string;
  matchType: MatchType;
  rawText: string;
  error: unknown;
  updatedAt?: Date;
  confirmed?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.matchDay.updateMany({
      where: { id: matchDayId, type: matchType, updatedAt },
      data: { rawText, parseStatus: confirmed ? "CONFIRMED" : "FAILED" }
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
        updatedAt: true,
        confirmedAt: true,
        participantCorrections: true,
        draftAssignments: true,
        draftTrialPlayers: true,
        trialPlayers: true,
        parseResults: { where: { modelName: "manual-confirmation" }, orderBy: { createdAt: "desc" }, take: 1 },
        assignments: {
          select: { playerId: true, teamColor: true, role: true, isCaptain: true, pointsEligible: true }
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

  const effectiveTrials = Array.isArray(matchDay.draftTrialPlayers) ? trialPlayersInputSchema.parse(matchDay.draftTrialPlayers) : matchDay.trialPlayers ?? [];
  const effectiveAssignments = Array.isArray(matchDay.draftAssignments) ? teamAssignmentInputSchema.array().parse(matchDay.draftAssignments) : matchDay.assignments;
  const corrections = Array.isArray(matchDay.participantCorrections) ? participantCorrectionsSchema.parse(matchDay.participantCorrections) : [];
  let parsed;
  try {
    const players = await prisma.player.findMany({
      include: { aliases: true },
      orderBy: { name: "asc" }
    });

    const recognition = confirmedParticipantRecognition(matchDay.parseResults?.[0]?.parsedJson,
      players.map((player) => ({ id: player.id, name: player.name,
        aliases: [...player.aliases.map((alias) => ({ alias: alias.alias, aliasType: alias.aliasType })),
          ...corrections.filter((row) => row.playerId === player.id).map((row) => ({ alias: row.rawName, aliasType: "MANUAL" }))]
      })), effectiveTrials, corrections);
    parsed = await parseMatchWithAi({
      rawText: body.rawText,
      matchType: body.matchType,
      players: recognition.players,
      trialPlayers: recognition.trials,
      teamAssignments: effectiveAssignments
    });
  } catch (error) {
    let parentStillExists = true;
    try {
      parentStillExists = await recordFailedParse({
        matchDayId: params.id,
        matchType: body.matchType,
        rawText: body.rawText,
        error,
        updatedAt: matchDay.updatedAt,
        confirmed: Boolean(matchDay.confirmedAt)
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

  parsed.parsed = applyParticipantCorrections(preserveConfirmedParticipants(parsed.parsed, matchDay.parseResults?.[0]?.parsedJson, effectiveTrials), corrections);
  const automaticTrials = assignAutomaticTrials(parsed.parsed, effectiveTrials, randomUUID);

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.matchDay.updateMany({
        where: { id: params.id, type: body.matchType, updatedAt: matchDay.updatedAt },
        data: {
          rawText: body.rawText,
          parseStatus: matchDay.confirmedAt ? "CONFIRMED" : "PARSED",
          ...(automaticTrials.length > effectiveTrials.length ? { draftTrialPlayers: automaticTrials } : {})
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
