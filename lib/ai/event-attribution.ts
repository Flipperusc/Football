import type { InternalTeam } from "@/lib/match-events";

const colors: Record<string, InternalTeam> = { 红: "red", 蓝: "blue", 白: "white" };
export const isOwnGoalText = (text: string) => /乌龙|own\s*goal/i.test(text);
export const isGuestText = (text: string) => /代打|客串|临时替|(?:替|为|代表|代)[红蓝白]队/.test(text);

/** Text is an event-sized fragment, never the whole section with other players' goals. */
export function parseEventAttribution(input: {
  rawText: string;
  ownGoal: boolean;
  rosterTeam?: string;
  teamA: InternalTeam;
  teamB: InternalTeam;
  suggestedTeam?: string;
  guestHint?: boolean;
}) {
  const { rawText, ownGoal, teamA, teamB } = input;
  const guest = input.guestHint || isGuestText(rawText);
  const beneficiary = rawText.match(/([红蓝白])队?(?:得分|获益|受益)/)?.[1];
  const represented = rawText.match(/(?:替|为|代表|代打|代)([红蓝白])队/)?.[1];
  const representedTeam = represented ? colors[represented] : undefined;
  let team: string | undefined;
  if (ownGoal || guest || beneficiary) {
    // An explicit textual attribution outranks the model's separate team field.
    if (beneficiary) {
      team = colors[beneficiary];
    } else if (representedTeam) {
      team = representedTeam === teamA || representedTeam === teamB
        ? ownGoal ? representedTeam === teamA ? teamB : teamA : representedTeam
        : undefined;
    } else if (ownGoal && !guest && (input.rosterTeam === teamA || input.rosterTeam === teamB)) {
      team = input.rosterTeam === teamA ? teamB : teamA;
    } else if (ownGoal || input.suggestedTeam !== input.rosterTeam) {
      // An ambiguous guest cannot silently become an ordinary original-team goal.
      team = input.suggestedTeam;
    }
  } else {
    // Unsubstantiated AI team guesses do not move ordinary roster goals.
    team = input.rosterTeam;
  }
  const validTeam = team === teamA || team === teamB ? team : undefined;
  return { team: validTeam, needsTeamSelection: !validTeam, special: Boolean(ownGoal || guest || beneficiary) };
}
