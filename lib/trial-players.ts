export type TrialDraft = { id: string; name: string; confirmed: boolean };
type Participant = { playerId: string | null; trialPlayerId?: string | null; rawName: string };
type TrialEvent = { type: string; scorer: Participant; assist?: Participant | null; count: number };

export function retainKnownPlayerCorrections<T extends { rawName: string; playerId: string }>(corrections: T[], players: { id: string }[]): T[] {
  const retainedIds = new Set(players.map((row) => row.id));
  return corrections.filter((row) => retainedIds.has(row.playerId));
}

export function formalNameConflict<T extends { id: string; name: string; aliases?: { alias: string }[] }>(name: string, players: T[]) {
  const normalized = name.trim();
  return players.find((player) => player.name.trim() === normalized || player.aliases?.some((alias) => alias.alias.trim() === normalized));
}

/** Both text and image roster recognition must retain this match's identity edits. */
export function applyRosterParticipantCorrections<T extends { rawName: string; playerId: string | null; needsReview: boolean }>(
  rows: T[], corrections: { rawName: string; playerId: string }[], players: { id: string; name: string }[]
): T[] {
  const normalize = (name: string) => name.replace(/\s+/g, "").toLowerCase();
  const mapping = new Map(corrections.map((row) => [normalize(row.rawName), row.playerId]));
  const known = new Map(players.map((player) => [player.id, player]));
  return rows.map((row) => {
    const id = mapping.get(normalize(row.rawName));
    const player = id ? known.get(id) : undefined;
    return player ? { ...row, playerId: player.id, matchedName: player.name, confidence: 1, needsReview: false } : row;
  });
}

export function mergePendingTrials(
  current: TrialDraft[],
  rows: { rawName: string; playerId: string | null; needsReview: boolean }[],
  createId: () => string
): TrialDraft[] {
  const next = [...current];
  for (const row of rows) {
    const name = row.rawName.trim();
    if (!name || (row.playerId && !row.needsReview) || next.some((trial) => trial.name === name)) continue;
    next.push({ id: createId(), name, confirmed: false });
  }
  return next;
}

export function summarizeTrialEvents(id: string, games: { sectionNo: number; events: TrialEvent[] }[]) {
  const goals = new Map<number, number>();
  const assists = new Map<number, number>();
  const ownGoals = new Map<number, number>();
  for (const game of games) {
    for (const event of game.events) {
      if (event.scorer.trialPlayerId === id) {
        const bucket = event.type === "own_goal" ? ownGoals : goals;
        bucket.set(game.sectionNo, (bucket.get(game.sectionNo) ?? 0) + event.count);
      }
      if (event.type !== "own_goal" && event.assist?.trialPlayerId === id) {
        assists.set(game.sectionNo, (assists.get(game.sectionNo) ?? 0) + event.count);
      }
    }
  }
  const format = (values: Map<number, number>) => [...values].sort(([a], [b]) => a - b)
    .map(([section, count]) => `第 ${section} 节${count > 1 ? ` ×${count}` : ""}`).join("、") || "—";
  return { goals: format(goals), assists: format(assists), ownGoals: format(ownGoals) };
}

export function replaceTrialParticipant<T extends Participant>(ref: T, trialId: string, player: { id: string; name: string }) {
  if (ref.trialPlayerId !== trialId) return ref;
  return { ...ref, playerId: player.id, trialPlayerId: null, matchedName: player.name, confidence: 1, candidates: [] };
}

/** Identity edits operate on a copy; the committed match remains untouched. */
export function resolveTrialReferences<T extends { games?: { events: { scorer: Participant; assist?: Participant | null }[] }[] }>(parsed: T, trialId: string, player: { id: string; name: string }) {
  const next = structuredClone(parsed);
  const rawNames = new Set<string>();
  for (const game of next.games ?? []) for (const event of game.events) {
    for (const role of ["scorer", "assist"] as const) {
      const person = event[role];
      if (person?.trialPlayerId !== trialId) continue;
      if (person.rawName.trim()) rawNames.add(person.rawName.trim());
      event[role] = replaceTrialParticipant(person, trialId, player);
    }
  }
  return { parsed: next, rawNames: [...rawNames] };
}

export function mergeParticipantCorrections(current: { rawName: string; playerId: string }[], rawNames: string[], playerId: string) {
  const normalize = (name: string) => name.replace(/\s+/g, "").toLowerCase();
  const entries = new Map(current.map((row) => [normalize(row.rawName), row]));
  for (const rawName of rawNames) if (rawName.trim()) entries.set(normalize(rawName), { rawName: rawName.trim(), playerId });
  return [...entries.values()];
}
