import { z } from "zod";
import { isAllowedStoredImageUrl, normalizeImageUrl } from "@/lib/image-url";

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

const storedImageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .transform((value) => normalizeImageUrl(value))
  .refine((value) => isAllowedStoredImageUrl(value), "Invalid image URL");

export const teamPhotoCreateSchema = z.object({
  imageUrl: storedImageUrlSchema,
  caption: z.string().trim().max(100).optional().nullable(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true)
});

export const teamPhotoUpdateSchema = teamPhotoCreateSchema.partial();

export const teamSettingUpdateSchema = z.object({
  logoUrl: storedImageUrlSchema.nullable()
});

export const seasonCreateSchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: seasonStatusSchema.default("ACTIVE")
});

export const seasonUpdateSchema = seasonCreateSchema.partial();

export const participantCorrectionsSchema = z.array(z.object({
  rawName: z.string().trim().min(1).max(100), playerId: z.string().min(1)
})).max(200).refine((rows) => new Set(rows.map((row) => row.rawName.replace(/\s+/g, "").toLowerCase())).size === rows.length, "同一原始名字只能有一项身份纠正");

export const trialPlayerInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  confirmed: z.boolean().default(false)
});
export const trialPlayersInputSchema = z.array(trialPlayerInputSchema).max(100).refine(
  (rows) => new Set(rows.map((row) => row.id)).size === rows.length, "试训身份不能重复"
);

export const resolveTrialSchema = z.object({
  trialId: z.string().uuid(),
  trialPlayers: trialPlayersInputSchema,
  name: z.string().trim().min(1).max(100).optional(),
  playerId: z.string().min(1).optional(),
  matchDayId: z.string().min(1).optional(),
  matchDayVersion: z.string().datetime().optional(),
  parsedJson: z.unknown().optional(),
  participantCorrections: participantCorrectionsSchema.default([])
}).refine((body) => Boolean(body.name) !== Boolean(body.playerId), "请选择创建正式姓名或匹配已有球员")
  .refine((body) => !body.matchDayId || Boolean(body.matchDayVersion), "请重新加载比赛后处理身份")
  .refine((body) => body.trialPlayers.some((trial) => trial.id === body.trialId), "试训身份不在当前待处理名单中");

export const teamAssignmentInputSchema = z.object({
  teamColor: teamColorSchema,
  playerId: z.string().min(1),
  role: assignmentRoleSchema.default("PLAYER"),
  isCaptain: z.boolean().default(false),
  // Retained for old clients; disabling matchday points is no longer supported.
  pointsEligible: z.boolean().optional().transform(() => true)
});

export const matchDayCreateSchema = z.object({
  seasonId: z.string().min(1),
  date: z.coerce.date(),
  type: matchTypeSchema,
  rawText: z.string().optional().nullable(),
  participantCorrections: participantCorrectionsSchema.default([]),
  trialPlayers: trialPlayersInputSchema.default([]),
  assignments: z.array(teamAssignmentInputSchema).default([])
});

export const matchDayUpdateSchema = z.object({
  seasonId: z.string().min(1).optional(),
  date: z.coerce.date().optional(),
  rawText: z.string().optional().nullable(),
  parseStatus: z.enum(["PENDING", "PARSED", "CONFIRMED", "FAILED"]).optional(),
  participantCorrections: participantCorrectionsSchema.optional(),
  trialPlayers: trialPlayersInputSchema.optional(),
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
  trialPlayers: trialPlayersInputSchema.optional(),
  eventConfirmationToken: z.string().max(256).optional(),
  matchDayVersion: z.string().datetime().optional(),
  teamAssignments: z.array(teamAssignmentInputSchema).optional(),
  manualTeamRanks: z
    .array(
      z.object({
        teamColor: z.enum(["RED", "BLUE", "WHITE"]),
        rank: z.number().int().min(1).max(3)
      })
    )
    .length(3)
    .superRefine((rows, context) => {
      if (new Set(rows.map((row) => row.teamColor)).size !== 3) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "红、蓝、白三队必须各设置一次排名"
        });
      }
      if (new Set(rows.map((row) => row.rank)).size !== 3) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "第 1、2、3 名不能重复"
        });
      }
    })
    .optional(),
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
