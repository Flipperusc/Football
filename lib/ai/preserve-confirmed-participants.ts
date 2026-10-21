import { parseResultSchema, type MatchedPlayer, type ParseResult } from "./schemas";
import type { TrialParticipant } from "@/lib/match-events";

/** Re-parsing text must not silently undo the administrator's identity corrections. */
export function preserveConfirmedParticipants(parsed: ParseResult, previousJson: unknown, trials: TrialParticipant[]): ParseResult {
  const previous = parseResultSchema.safeParse(previousJson);
  if (!previous.success || previous.data.matchType !== "internal" || parsed.matchType !== "internal") return parsed;
  const identities = new Map<string, MatchedPlayer[]>();
  for (const game of previous.data.games) for (const event of game.events) for (const person of [event.scorer, event.assist]) {
    if (!person || !(person.playerId || person.trialPlayerId)) continue;
    const key = person.rawName.trim();
    const entries = identities.get(key) ?? [];
    if (!entries.some((old) => old.playerId === person.playerId && old.trialPlayerId === person.trialPlayerId)) entries.push(person);
    identities.set(key, entries);
  }
  for (const game of parsed.games) for (const event of game.events) for (const role of ["scorer", "assist"] as const) {
    const person = event[role];
    if (!person) continue;
    const previousPeople = identities.get(person.rawName.trim());
    if (!previousPeople?.length) continue;
    const old = previousPeople[0];
    if (previousPeople.length !== 1 || (old.trialPlayerId && !trials.some((trial) => trial.id === old.trialPlayerId))) {
      event[role] = { ...person, playerId: null, trialPlayerId: null, confidence: 0 };
      event.needsReview = true;
      parsed.uncertainItems.push({ rawText: event.rawText, reason: "此前人工身份存在冲突，请重新匹配球员", candidates: previousPeople });
    } else if (person.playerId !== old.playerId || person.trialPlayerId !== old.trialPlayerId) {
      event[role] = { ...old, rawName: person.rawName };
      event.needsReview = true;
      parsed.uncertainItems.push({ rawText: event.rawText, reason: "已保留此前人工确认的球员身份，请复核新解析内容", candidates: [old] });
    }
  }
  return parsed;
}

/** Recognition hints from the latest snapshot allow the rule parser to find names
 * before preservation runs. These hints never change global aliases or rosters.
 */
export function confirmedParticipantRecognition(
  previousJson: unknown,
  players: import("./local-parser").ParserPlayer[],
  trials: TrialParticipant[],
  corrections: { rawName: string; playerId: string }[] = []
) {
  const previous = parseResultSchema.safeParse(previousJson);
  const recognizedPlayers = players.map((player) => ({ ...player, aliases: [...player.aliases] }));
  const recognizedTrials = [...trials];
  if (!previous.success || previous.data.matchType !== "internal") return { players: recognizedPlayers, trials: recognizedTrials };
  const normalized = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const overriddenNames = new Set(corrections.map((row) => normalized(row.rawName)));
  for (const event of previous.data.games.flatMap((game) => game.events)) for (const person of [event.scorer, event.assist]) {
    if (!person?.rawName.trim() || overriddenNames.has(normalized(person.rawName))) continue;
    const player = recognizedPlayers.find((row) => row.id === person.playerId);
    if (player && !player.aliases.some((alias) => normalized(alias.alias) === normalized(person.rawName))) player.aliases.push({ alias: person.rawName, aliasType: "MANUAL" });
    const trial = trials.find((row) => row.id === person.trialPlayerId);
    if (trial && !recognizedTrials.some((row) => row.id === trial.id && normalized(row.name) === normalized(person.rawName))) recognizedTrials.push({ ...trial, name: person.rawName });
  }
  return { players: recognizedPlayers, trials: recognizedTrials };
}
