CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "AliasType" AS ENUM ('NICKNAME', 'TYPO', 'SHORT_NAME', 'MANUAL');
CREATE TYPE "SeasonStatus" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "MatchType" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'PARSED', 'CONFIRMED', 'FAILED');
CREATE TYPE "TeamColor" AS ENUM ('RED', 'BLUE', 'WHITE', 'EXTERNAL');
CREATE TYPE "AssignmentRole" AS ENUM ('PLAYER', 'GOALKEEPER');
CREATE TYPE "ParseResultStatus" AS ENUM ('SUCCESS', 'NEEDS_REVIEW', 'FAILED');

CREATE TABLE "Player" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "jerseyNumber" INTEGER,
  "position" TEXT,
  "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerAlias" (
  "id" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "aliasType" "AliasType" NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Season" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchDay" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "type" "MatchType" NOT NULL,
  "rawText" TEXT,
  "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamAssignment" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "teamColor" "TeamColor" NOT NULL,
  "playerId" TEXT NOT NULL,
  "role" "AssignmentRole" NOT NULL DEFAULT 'PLAYER',
  "isCaptain" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "TeamAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalGame" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "sectionNo" INTEGER NOT NULL,
  "teamA" "TeamColor" NOT NULL,
  "teamB" "TeamColor" NOT NULL,
  "scoreA" INTEGER NOT NULL,
  "scoreB" INTEGER NOT NULL,
  "rawText" TEXT,
  CONSTRAINT "InternalGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoalEvent" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "internalGameId" TEXT,
  "matchType" "MatchType" NOT NULL,
  "teamColor" "TeamColor",
  "scorerId" TEXT NOT NULL,
  "assistPlayerId" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "rawText" TEXT,
  "needsReview" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "GoalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMatchdayResult" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "teamColor" "TeamColor" NOT NULL,
  "matchPoints" INTEGER NOT NULL,
  "goalsFor" INTEGER NOT NULL,
  "goalsAgainst" INTEGER NOT NULL,
  "goalDifference" INTEGER NOT NULL,
  "rank" INTEGER,
  "seasonPointsAwarded" INTEGER NOT NULL,
  "needsManualReview" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "TeamMatchdayResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerMatchdayPoint" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "basePoints" INTEGER NOT NULL DEFAULT 0,
  "bonusPoints" INTEGER NOT NULL DEFAULT 0,
  "totalPoints" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  CONSTRAINT "PlayerMatchdayPoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Award" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "playerId" TEXT,
  "points" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "rawText" TEXT,
  CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchParseResult" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "rawText" TEXT NOT NULL,
  "parsedJson" JSONB NOT NULL,
  "modelName" TEXT NOT NULL,
  "status" "ParseResultStatus" NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchParseResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerAlias_playerId_alias_key" ON "PlayerAlias"("playerId", "alias");
CREATE INDEX "PlayerAlias_alias_idx" ON "PlayerAlias"("alias");
CREATE INDEX "MatchDay_seasonId_date_idx" ON "MatchDay"("seasonId", "date");
CREATE UNIQUE INDEX "TeamAssignment_matchDayId_playerId_key" ON "TeamAssignment"("matchDayId", "playerId");
CREATE INDEX "TeamAssignment_matchDayId_teamColor_idx" ON "TeamAssignment"("matchDayId", "teamColor");
CREATE UNIQUE INDEX "InternalGame_matchDayId_sectionNo_key" ON "InternalGame"("matchDayId", "sectionNo");
CREATE INDEX "GoalEvent_matchDayId_idx" ON "GoalEvent"("matchDayId");
CREATE INDEX "GoalEvent_scorerId_idx" ON "GoalEvent"("scorerId");
CREATE INDEX "GoalEvent_assistPlayerId_idx" ON "GoalEvent"("assistPlayerId");
CREATE UNIQUE INDEX "TeamMatchdayResult_matchDayId_teamColor_key" ON "TeamMatchdayResult"("matchDayId", "teamColor");
CREATE UNIQUE INDEX "PlayerMatchdayPoint_matchDayId_playerId_key" ON "PlayerMatchdayPoint"("matchDayId", "playerId");
CREATE INDEX "MatchParseResult_matchDayId_createdAt_idx" ON "MatchParseResult"("matchDayId", "createdAt");

ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchDay" ADD CONSTRAINT "MatchDay_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAssignment" ADD CONSTRAINT "TeamAssignment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalGame" ADD CONSTRAINT "InternalGame_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_internalGameId_fkey" FOREIGN KEY ("internalGameId") REFERENCES "InternalGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_scorerId_fkey" FOREIGN KEY ("scorerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_assistPlayerId_fkey" FOREIGN KEY ("assistPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamMatchdayResult" ADD CONSTRAINT "TeamMatchdayResult_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchdayPoint" ADD CONSTRAINT "PlayerMatchdayPoint_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerMatchdayPoint" ADD CONSTRAINT "PlayerMatchdayPoint_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Award" ADD CONSTRAINT "Award_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Award" ADD CONSTRAINT "Award_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchParseResult" ADD CONSTRAINT "MatchParseResult_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
