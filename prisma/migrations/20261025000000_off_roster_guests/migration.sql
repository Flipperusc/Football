ALTER TABLE "GoalEvent"
  ADD COLUMN "scorerIsGuest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assistIsGuest" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TrialResolution" (
  "id" TEXT NOT NULL,
  "sourceName" TEXT NOT NULL,
  "requestedName" TEXT,
  "playerId" TEXT NOT NULL,
  "matchDayId" TEXT,
  "resultVersion" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrialResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrialResolution_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrialResolution_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TrialResolution_playerId_idx" ON "TrialResolution"("playerId");
CREATE INDEX "TrialResolution_matchDayId_idx" ON "TrialResolution"("matchDayId");
