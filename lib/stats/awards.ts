export const BEST_DEFENDER_AWARD_NAME = "最佳后卫";

export function isBestDefenderAwardName(name?: string | null) {
  return name?.trim() === BEST_DEFENDER_AWARD_NAME;
}
