CREATE TYPE "StatAdjustmentMetric" AS ENUM (
  'INTERNAL_GOALS',
  'INTERNAL_ASSISTS',
  'INTERNAL_APPEARANCES',
  'INTERNAL_SEASON_POINTS',
  'EXTERNAL_GOALS',
  'EXTERNAL_ASSISTS',
  'EXTERNAL_APPEARANCES'
);

CREATE TYPE "StatAdjustmentOperation" AS ENUM ('SET', 'ADJUST');

ALTER TABLE "Player" ADD COLUMN "avatarUrl" TEXT;

CREATE TABLE "PlayerStatAdjustment" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "metric" "StatAdjustmentMetric" NOT NULL,
  "operation" "StatAdjustmentOperation" NOT NULL DEFAULT 'ADJUST',
  "value" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerStatAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerStatAdjustment_seasonId_playerId_createdAt_idx"
  ON "PlayerStatAdjustment"("seasonId", "playerId", "createdAt");

ALTER TABLE "PlayerStatAdjustment"
  ADD CONSTRAINT "PlayerStatAdjustment_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerStatAdjustment"
  ADD CONSTRAINT "PlayerStatAdjustment_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
