import { z } from "zod";

export const playerStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export const aliasTypeSchema = z.enum(["NICKNAME", "TYPO", "SHORT_NAME", "MANUAL"]);
export const seasonStatusSchema = z.enum(["ACTIVE", "ENDED"]);
export const matchTypeSchema = z.enum(["INTERNAL", "EXTERNAL"]);
export const teamColorSchema = z.enum(["RED", "BLUE", "WHITE", "EXTERNAL"]);
export const assignmentRoleSchema = z.enum(["PLAYER", "GOALKEEPER"]);
export const statAdjustmentMetricSchema = z.enum([
  "INTERNAL_GOALS",
  "INTERNAL_ASSISTS",
  "INTERNAL_APPEARANCES",
  "INTERNAL_SEASON_POINTS",
  "EXTERNAL_GOALS",
  "EXTERNAL_ASSISTS",
  "EXTERNAL_APPEARANCES"
]);
export const statAdjustmentOperationSchema = z.enum(["SET", "ADJUST"]);

export const playerCreateSchema = z.object({
  name: z.string().trim().min(1),
  jerseyNumber: z.number().int().positive().optional().nullable(),
  position: z.string().trim().optional().nullable(),
  avatarUrl: z.string().trim().max(2000).optional().nullable(),
  status: playerStatusSchema.default("ACTIVE"),
  aliases: z
    .array(
      z.object({
        alias: z.string().trim().min(1),
        aliasType: aliasTypeSchema.default("MANUAL")
      })
    )
    .optional()
});

export const playerUpdateSchema = playerCreateSchema.partial();

export const playerListParseRequestSchema = z.object({
  rawText: z.string().min(1)
});

export const playerBulkCreateSchema = z.object({
  players: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        jerseyNumber: z.number().int().positive().optional().nullable(),
        position: z.string().trim().optional().nullable(),
        avatarUrl: z.string().trim().max(2000).optional().nullable(),
        status: playerStatusSchema.default("ACTIVE"),
        aliases: z
          .array(
            z.object({
              alias: z.string().trim().min(1),
              aliasType: aliasTypeSchema.default("MANUAL")
            })
          )
          .optional()
      })
    )
    .min(1)
});

export const aliasCreateSchema = z.object({
  alias: z.string().trim().min(1),
  aliasType: aliasTypeSchema.default("MANUAL")
});

export const playerStatAdjustmentCreateSchema = z.object({
  seasonId: z.string().min(1),
  metric: statAdjustmentMetricSchema,
  operation: statAdjustmentOperationSchema.default("ADJUST"),
  value: z.number().int(),
  reason: z.string().trim().min(1).max(500)
});

export const teamPhotoCreateSchema = z.object({
  imageUrl: z.string().trim().min(1).max(2000),
  caption: z.string().trim().max(100).optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true)
});

export const teamPhotoUpdateSchema = teamPhotoCreateSchema.partial();

export const seasonCreateSchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: seasonStatusSchema.default("ACTIVE")
});

export const seasonUpdateSchema = seasonCreateSchema.partial();

export const teamAssignmentInputSchema = z.object({
  teamColor: teamColorSchema,
  playerId: z.string().min(1),
  role: assignmentRoleSchema.default("PLAYER"),
  isCaptain: z.boolean().default(false)
});

export const matchDayCreateSchema = z.object({
  seasonId: z.string().min(1),
  date: z.coerce.date(),
  type: matchTypeSchema,
  rawText: z.string().optional().nullable(),
  assignments: z.array(teamAssignmentInputSchema).default([])
});

export const matchDayUpdateSchema = z.object({
  seasonId: z.string().min(1).optional(),
  date: z.coerce.date().optional(),
  rawText: z.string().optional().nullable(),
  parseStatus: z.enum(["PENDING", "PARSED", "CONFIRMED", "FAILED"]).optional(),
  assignments: z.array(teamAssignmentInputSchema).optional()
});

export const parseRequestSchema = z.object({
  rawText: z.string().min(1),
  matchType: matchTypeSchema,
  teamAssignments: z.array(teamAssignmentInputSchema).default([])
});

export const rosterParseRequestSchema = z.object({
  rawText: z.string().min(1),
  matchType: matchTypeSchema
});

export const confirmRequestSchema = z.object({
  parsedJson: z.unknown(),
  teamAssignments: z.array(teamAssignmentInputSchema).optional(),
  saveAliases: z
    .array(
      z.object({
        playerId: z.string().min(1),
        rawName: z.string().trim().min(1),
        aliasType: aliasTypeSchema.default("MANUAL")
      })
    )
    .default([])
});
