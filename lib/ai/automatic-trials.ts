import type { TrialDraft } from "@/lib/trial-players";

export const isTrialLabel = (name: string) => /试训|临时球员|临时队员|临时人员|试踢/.test(name);

type Person = { rawName: string; playerId: string | null; trialPlayerId?: string | null; matchedName?: string | null; confidence?: number };
/** Keep identities scoped to this matchday. Empty event rows are not people. */
export function assignAutomaticTrials(
  parsed: { matchType: string; games?: { events: { scorer: Person; assist?: Person | null; needsReview?: boolean }[] }[] },
  existing: TrialDraft[], createId: () => string
) {
  const trials = existing.map((row) => ({ ...row }));
  if (parsed.matchType !== "internal") return trials;
  for (const game of parsed.games ?? []) for (const event of game.events) {
    for (const person of [event.scorer, event.assist]) {
      if (!person || person.playerId || person.trialPlayerId || !person.rawName.trim()) continue;
      const name = person.rawName.trim();
      let trial = trials.find((row) => row.name === name);
      if (!trial) { trial = { id: createId(), name, confirmed: false }; trials.push(trial); }
      person.playerId = null;
      person.trialPlayerId = trial.id;
      person.matchedName = trial.name;
      person.confidence = 1;
      event.needsReview = true;
    }
  }
  return trials;
}
