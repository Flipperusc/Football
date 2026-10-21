ALTER TABLE "TeamAssignment" ADD COLUMN "pointsEligible" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "TrialPlayer" (
  "id" TEXT NOT NULL,
  "matchDayId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "TrialPlayer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrialPlayer_matchDayId_idx" ON "TrialPlayer"("matchDayId");
ALTER TABLE "TrialPlayer" ADD CONSTRAINT "TrialPlayer_matchDayId_fkey" FOREIGN KEY ("matchDayId") REFERENCES "MatchDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ALTER COLUMN "scorerId" DROP NOT NULL;
ALTER TABLE "GoalEvent" ADD COLUMN "scorerTrialPlayerId" TEXT, ADD COLUMN "assistTrialPlayerId" TEXT;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_scorerTrialPlayerId_fkey" FOREIGN KEY ("scorerTrialPlayerId") REFERENCES "TrialPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_assistTrialPlayerId_fkey" FOREIGN KEY ("assistTrialPlayerId") REFERENCES "TrialPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_scorer_identity_check" CHECK (("scorerId" IS NOT NULL)::int + ("scorerTrialPlayerId" IS NOT NULL)::int = 1);
ALTER TABLE "GoalEvent" ADD CONSTRAINT "GoalEvent_assist_identity_check" CHECK (NOT ("assistPlayerId" IS NOT NULL AND "assistTrialPlayerId" IS NOT NULL));

ALTER TABLE "MatchDay" ADD COLUMN "draftAssignments" JSONB, ADD COLUMN "draftTrialPlayers" JSONB;

ALTER TABLE "MatchDay" ADD COLUMN "participantCorrections" JSONB;
