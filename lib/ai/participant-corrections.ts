import type { ParseResult } from "./schemas";
/** Matchday-specific name corrections are explicit decisions, never global aliases. */
export function applyParticipantCorrections(parsed: ParseResult, corrections: { rawName: string; playerId: string }[]): ParseResult {
  const normalize = (name: string) => name.replace(/\s+/g, "").toLowerCase();
  const events = parsed.matchType === "internal" ? parsed.games.flatMap((game) => game.events) : parsed.events;
  const people = [...events.flatMap((event) => [event.scorer, event.assist]), ...parsed.awards.flatMap((award) => award.players), ...parsed.bonusPoints.map((bonus) => bonus.player)];
  for (const person of people) {
    if (!person) continue;
    const correction = corrections.find((row) => normalize(row.rawName) === normalize(person.rawName));
    if (correction) {
      person.playerId = correction.playerId;
      person.trialPlayerId = null;
      person.matchedName = null;
      person.confidence = 1;
      person.candidates = [];
    }
  }
  return parsed;
}

/** Once a name appears in confirmed events, that snapshot is the identity authority.
 * Retain only unused roster hints so future events can still recognize those names.
 */
export function unusedParticipantCorrections(parsed: ParseResult, corrections: { rawName: string; playerId: string }[]) {
  const normalize = (name: string) => name.replace(/\s+/g, "").toLowerCase();
  const events = parsed.matchType === "internal" ? parsed.games.flatMap((game) => game.events) : parsed.events;
  const usedNames = new Set(events.flatMap((event) => [event.scorer, event.assist]).filter((person) => person != null).map((person) => normalize(person.rawName)));
  return corrections.filter((row) => !usedNames.has(normalize(row.rawName)));
}
