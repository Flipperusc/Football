-- Restore only previously excluded players, using their last committed input.
-- Draft parses must never become the source of official points.
WITH restored AS (
  SELECT a."matchDayId", a."playerId",
    COALESCE(r."seasonPointsAwarded", 0) AS base,
    COALESCE((SELECT SUM((b->>'points')::int)
      FROM jsonb_array_elements(COALESCE(p."parsedJson"->'bonusPoints', '[]'::jsonb)) b
      WHERE b->'player'->>'playerId' = a."playerId"), 0)
    + COALESCE((SELECT SUM(w.points) FROM "Award" w
      WHERE w."matchDayId" = a."matchDayId" AND w."playerId" = a."playerId"), 0) AS bonus
  FROM "TeamAssignment" a
  JOIN "MatchDay" m ON m.id = a."matchDayId" AND m.type = 'INTERNAL' AND m."parseStatus" = 'CONFIRMED'
  LEFT JOIN "TeamMatchdayResult" r ON r."matchDayId" = a."matchDayId" AND r."teamColor" = a."teamColor"
  LEFT JOIN LATERAL (SELECT "parsedJson" FROM "MatchParseResult"
    WHERE "matchDayId" = a."matchDayId" AND "modelName" = 'manual-confirmation' AND status = 'SUCCESS'
    ORDER BY "createdAt" DESC LIMIT 1) p ON true
  WHERE a."pointsEligible" = false
)
UPDATE "PlayerMatchdayPoint" v SET "basePoints" = restored.base,
  "bonusPoints" = restored.bonus, "totalPoints" = restored.base + restored.bonus
FROM restored WHERE v."matchDayId" = restored."matchDayId" AND v."playerId" = restored."playerId";

UPDATE "TeamAssignment" SET "pointsEligible" = true WHERE "pointsEligible" = false;
UPDATE "MatchDay" SET "draftAssignments" = (
  SELECT jsonb_agg(jsonb_set(entry, '{pointsEligible}', 'true'::jsonb))
  FROM jsonb_array_elements("draftAssignments") entry
) WHERE jsonb_typeof("draftAssignments") = 'array' AND jsonb_array_length("draftAssignments") > 0;
