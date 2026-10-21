import { goalEventMarker, type StoredGoalAttribution } from "@/lib/match-events";
import type { TeamColor } from "./types";

type ShareEvent = StoredGoalAttribution & {
  internalGameId?: string | null;
  count: number;
  scorer?: { name: string } | null;
  assistPlayer?: { name: string } | null;
  scorerTrialPlayer?: { name: string } | null;
  assistTrialPlayer?: { name: string } | null;
};

/** A single source for the visible report and its exported image. */
export function shareEventText(
  game: { id: string; teamA: TeamColor; teamB: TeamColor },
  teamColor: TeamColor,
  events: ShareEvent[],
  kind: "NORMAL" | "OWN_GOAL" | "ASSIST"
) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.internalGameId !== game.id || event.teamColor !== teamColor) continue;
    if (kind === "OWN_GOAL" ? event.kind !== "OWN_GOAL" : event.kind === "OWN_GOAL") continue;
    const isAssist = kind === "ASSIST";
    const trial = isAssist ? event.assistTrialPlayer : event.scorerTrialPlayer;
    const formal = isAssist ? event.assistPlayer : event.scorer;
    if (!trial && !formal) continue;
    const name = trial
      ? trial.name + (kind === "OWN_GOAL" ? "（试训、乌龙）" : "（试训）")
      : formal!.name + goalEventMarker(event, game, isAssist ? "assist" : "scorer");
    counts.set(name, (counts.get(name) ?? 0) + event.count);
  }
  return Array.from(counts, ([name, count]) => name + (count > 1 ? `×${count}` : "")).join("、") || "—";
}
