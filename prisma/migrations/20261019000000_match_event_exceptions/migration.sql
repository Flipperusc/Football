CREATE TYPE "GoalKind" AS ENUM ('NORMAL', 'OWN_GOAL');

ALTER TABLE "GoalEvent"
  ADD COLUMN "kind" "GoalKind" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "scorerRosterTeam" "TeamColor",
  ADD COLUMN "assistRosterTeam" "TeamColor",
  ADD COLUMN "exceptionConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "exceptionConfirmedBy" TEXT;
