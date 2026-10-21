import { z } from "zod";

export const aiTeamColorSchema = z.enum(["red", "blue", "white", "external"]);

export const matchedPlayerSchema = z.object({
  rawName: z.string(),
  playerId: z.string().nullable(),
  trialPlayerId: z.string().min(1).nullable().optional(),
  matchedName: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  candidates: z
    .array(
      z.object({
        playerId: z.string(),
        name: z.string(),
        confidence: z.number().min(0).max(1)
      })
    )
    .default([])
}).refine((person) => !(person.playerId && person.trialPlayerId), "球员不能同时为正式和试训身份");

export const parsedGoalEventSchema = z.object({
  type: z.enum(["goal", "own_goal"]),
  team: aiTeamColorSchema.optional(),
  needsTeamSelection: z.boolean().optional(),
  scorer: matchedPlayerSchema,
  assist: matchedPlayerSchema.nullable().optional(),
  count: z.number().int().positive().default(1),
  rawText: z.string(),
  confidence: z.number().min(0).max(1).default(0.8),
  needsReview: z.boolean().default(false)
});

export const parsedInternalGameSchema = z.object({
  sectionNo: z.number().int().min(1).max(6),
  teamA: aiTeamColorSchema.exclude(["external"]),
  teamB: aiTeamColorSchema.exclude(["external"]),
  scoreA: z.number().int().min(0),
  scoreB: z.number().int().min(0),
  events: z.array(parsedGoalEventSchema).default([]),
  rawText: z.string()
});

export const parsedAwardSchema = z.object({
  name: z.string(),
  players: z.array(matchedPlayerSchema).default([]),
  points: z.number().int().default(0),
  rawText: z.string()
});

export const parsedBonusPointSchema = z.object({
  player: matchedPlayerSchema,
  points: z.number().int(),
  reason: z.string(),
  rawText: z.string()
});

export const uncertainItemSchema = z.object({
  rawText: z.string(),
  reason: z.string(),
  candidates: z.array(matchedPlayerSchema).default([])
});

export const internalParseResultSchema = z.object({
  matchType: z.literal("internal"),
  games: z.array(parsedInternalGameSchema),
  awards: z.array(parsedAwardSchema).default([]),
  bonusPoints: z.array(parsedBonusPointSchema).default([]),
  uncertainItems: z.array(uncertainItemSchema).default([])
});

export const externalParseResultSchema = z.object({
  matchType: z.literal("external"),
  events: z.array(parsedGoalEventSchema.refine((event) => event.type === "goal", "队外赛暂不支持乌龙球事件")).default([]),
  awards: z.array(parsedAwardSchema).default([]),
  bonusPoints: z.array(parsedBonusPointSchema).default([]),
  uncertainItems: z.array(uncertainItemSchema).default([])
});

export const parseResultSchema = z.discriminatedUnion("matchType", [
  internalParseResultSchema,
  externalParseResultSchema
]);

export type MatchedPlayer = z.infer<typeof matchedPlayerSchema>;
export type ParsedGoalEvent = z.infer<typeof parsedGoalEventSchema>;
export type InternalParseResult = z.infer<typeof internalParseResultSchema>;
export type ExternalParseResult = z.infer<typeof externalParseResultSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;
