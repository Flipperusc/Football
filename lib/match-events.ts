import type { TeamColor } from "@/lib/stats/types";

export type InternalTeam = "red" | "blue" | "white";
export type InternalTeamColor = Exclude<TeamColor, "EXTERNAL">;
export const internalTeamLabels: Record<InternalTeam, string> = { red: "红队", blue: "蓝队", white: "白队" };
export const internalTeamToDb = { red: "RED", blue: "BLUE", white: "WHITE" } as const;

type EventPlayer = { playerId: string | null; rawName: string; matchedName?: string | null };
export type MatchEvent = {
  type: "goal" | "own_goal";
  team?: InternalTeam | "external";
  needsTeamSelection?: boolean;
  scorer: EventPlayer;
  assist?: EventPlayer | null;
  count: number;
};
export type EventGame = {
  sectionNo: number;
  teamA: InternalTeam;
  teamB: InternalTeam;
  scoreA: number;
  scoreB: number;
  events: MatchEvent[];
};
export type EventAssignment = { playerId: string; teamColor: TeamColor };
export type EventException = {
  key: string;
  gameIndex: number;
  eventIndex: number;
  sectionNo: number;
  teamA: InternalTeam;
  teamB: InternalTeam;
  type: MatchEvent["type"];
  team?: InternalTeam;
  representedTeam?: InternalTeam;
  scorerName: string;
  scorerTeam: InternalTeam;
  assistName?: string;
  assistTeam?: InternalTeam;
  count: number;
  reasons: ("OWN_GOAL" | "SCORER_GUEST" | "ASSIST_GUEST" | "TEAM_REQUIRED")[];
};
export type EventResolution = {
  key: string;
  teamColor: InternalTeamColor;
  scorerRosterTeam: InternalTeamColor;
  assistRosterTeam: InternalTeamColor | null;
  isException: boolean;
};

export function rosterTeam(playerId: string | null | undefined, assignments: EventAssignment[]): InternalTeam | undefined {
  const team = assignments.find((assignment) => assignment.playerId === playerId)?.teamColor;
  return team && team !== "EXTERNAL" ? team.toLowerCase() as InternalTeam : undefined;
}

export function defaultEventTeam(event: MatchEvent, game: Pick<EventGame, "teamA" | "teamB">, assignments: EventAssignment[]) {
  const original = rosterTeam(event.scorer.playerId, assignments);
  if (original !== game.teamA && original !== game.teamB) return undefined;
  return event.type === "own_goal" ? (original === game.teamA ? game.teamB : game.teamA) : original;
}

/** Read-only inspection shared by the confirmation UI and the authoritative server write. */
export function inspectInternalEvents(parsed: { games: EventGame[] }, assignments: EventAssignment[]) {
  const issues: string[] = [];
  const exceptions: EventException[] = [];
  const resolutions: EventResolution[] = [];
  const assignedIds = new Set<string>();
  for (const assignment of assignments) {
    if (assignedIds.has(assignment.playerId)) issues.push("同一球员不能重复分队");
    if (assignment.teamColor === "EXTERNAL") issues.push("队内赛名单只能使用红、蓝、白队");
    assignedIds.add(assignment.playerId);
  }
  const sections = new Set<number>();
  parsed.games.forEach((game, gameIndex) => {
    const prefix = `第 ${game.sectionNo} 节`;
    if (sections.has(game.sectionNo)) issues.push(`${prefix}重复，请修正节次`);
    sections.add(game.sectionNo);
    if (game.teamA === game.teamB) issues.push(`${prefix}必须由两支不同队伍参赛`);
    const knownGoals = { [game.teamA]: 0, [game.teamB]: 0 };
    game.events.forEach((event, eventIndex) => {
      const key = `${gameIndex}:${eventIndex}`;
      const scorerName = event.scorer.matchedName || event.scorer.rawName || "未知球员";
      if (!event.scorer.playerId || (event.assist && !event.assist.playerId)) {
        issues.push(`${prefix}仍有未匹配的进球或助攻球员`);
        return;
      }
      const scorerTeam = rosterTeam(event.scorer.playerId, assignments);
      const assistTeam = event.assist ? rosterTeam(event.assist.playerId, assignments) : undefined;
      if (!scorerTeam || (event.assist && !assistTeam)) {
        issues.push(`${prefix}球员尚未分队，请先补充当天红、蓝、白分队名单`);
        return;
      }
      if (event.type === "own_goal" && event.assist) {
        issues.push(`${prefix}乌龙球不计助攻，请清空助攻球员`);
      }
      const team = event.team ?? (event.needsTeamSelection ? undefined : defaultEventTeam(event, game, assignments));
      if (team && team !== game.teamA && team !== game.teamB) {
        issues.push(`${prefix}得分队必须为本节参赛的两支队伍之一`);
        return;
      }
      const representedTeam = team
        ? event.type === "own_goal" ? (team === game.teamA ? game.teamB : game.teamA) : team
        : undefined;
      const reasons: EventException["reasons"] = [];
      if (event.type === "own_goal") reasons.push("OWN_GOAL");
      if (!team) reasons.push("TEAM_REQUIRED");
      if (representedTeam && scorerTeam !== representedTeam) reasons.push("SCORER_GUEST");
      if (event.type === "goal" && team && assistTeam && assistTeam !== team) reasons.push("ASSIST_GUEST");
      if (reasons.length) {
        exceptions.push({
          key, gameIndex, eventIndex, sectionNo: game.sectionNo, teamA: game.teamA, teamB: game.teamB,
          type: event.type, team, representedTeam, scorerName, scorerTeam,
          assistName: event.assist ? event.assist.matchedName || event.assist.rawName : undefined,
          assistTeam, count: event.count, reasons
        });
      }
      if (team) {
        knownGoals[team] += event.count;
        resolutions.push({
          key, teamColor: internalTeamToDb[team], scorerRosterTeam: internalTeamToDb[scorerTeam],
          assistRosterTeam: assistTeam ? internalTeamToDb[assistTeam] : null, isException: reasons.length > 0
        });
      }
    });
    if (knownGoals[game.teamA] > game.scoreA || knownGoals[game.teamB] > game.scoreB) {
      issues.push(`${prefix}已记录进球超过对应队伍比分，请检查得分队、进球数量或比分`);
    }
  });
  return { issues, exceptions, resolutions };
}

export type StoredGoalAttribution = {
  kind?: "NORMAL" | "OWN_GOAL";
  teamColor?: TeamColor | null;
  scorerRosterTeam?: TeamColor | null;
  assistRosterTeam?: TeamColor | null;
};

/** Historical rows without roster snapshots retain their original display. */
export function goalEventMarker(
  event: StoredGoalAttribution,
  game?: { teamA: TeamColor; teamB: TeamColor } | null,
  role: "scorer" | "assist" = "scorer"
) {
  const ownGoal = event.kind === "OWN_GOAL";
  const representedTeam = ownGoal
    ? game && event.teamColor === game.teamA ? game.teamB
      : game && event.teamColor === game.teamB ? game.teamA : undefined
    : event.teamColor;
  const originalTeam = role === "scorer" ? event.scorerRosterTeam : event.assistRosterTeam;
  const markers = [];
  if (originalTeam && representedTeam && originalTeam !== representedTeam) markers.push("代打");
  if (ownGoal && role === "scorer") markers.push("乌龙");
  return markers.length ? `（${markers.join("、")}）` : "";
}
