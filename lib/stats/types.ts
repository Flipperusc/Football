export type TeamColor = "RED" | "BLUE" | "WHITE" | "EXTERNAL";
export type MatchType = "INTERNAL" | "EXTERNAL";

export type PlayerInput = {
  id: string;
  name: string;
  position?: string | null;
};

export type MatchDayInput = {
  id: string;
  seasonId: string;
  type: MatchType;
};

export type InternalGameInput = {
  id?: string;
  matchDayId: string;
  sectionNo: number;
  teamA: TeamColor;
  teamB: TeamColor;
  scoreA: number;
  scoreB: number;
};

export type TeamAssignmentInput = {
  matchDayId: string;
  teamColor: TeamColor;
  playerId: string;
};

export type GoalEventInput = {
  kind?: "NORMAL" | "OWN_GOAL";
  matchDayId: string;
  matchType: MatchType;
  teamColor?: TeamColor | null;
  scorerId: string;
  assistPlayerId?: string | null;
  count: number;
};

export type BonusPointInput = {
  playerId: string;
  points: number;
  reason?: string;
};

export type AwardInput = {
  matchDayId: string;
  name: string;
  playerId?: string | null;
  points: number;
};

export type PlayerPointInput = {
  matchDayId: string;
  playerId: string;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
};

export type TeamResult = {
  teamColor: TeamColor;
  matchPoints: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  rank: number | null;
  seasonPointsAwarded: number;
  needsManualReview: boolean;
};

export type PlayerSeasonStats = {
  playerId: string;
  name: string;
  position?: string | null;
  internalGoals: number;
  internalAssists: number;
  internalAppearances: number;
  internalSeasonPoints: number;
  bestDefenderAwards: number;
  externalGoals: number;
  externalAssists: number;
  externalAppearances: number;
  totalGoals: number;
  totalAssists: number;
  totalAppearances: number;
  goalsPerAppearance: number;
  assistsPerAppearance: number;
  pointsPerInternalAppearance: number;
};
