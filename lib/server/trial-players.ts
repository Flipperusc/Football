import type { Prisma } from "@prisma/client";
import type { TrialParticipant } from "@/lib/match-events";

/** Check ownership before any mutation. IDs are never transferable between matchdays. */
export async function assertTrialPlayerScope(tx: Prisma.TransactionClient, matchDayId: string, trials: TrialParticipant[]) {
  if (new Set(trials.map((row) => row.id)).size !== trials.length) throw new Error("试训身份不能重复");
  if (!trials.length) return;
  const existing = await tx.trialPlayer.findMany({ where: { id: { in: trials.map((row) => row.id) } }, select: { id: true, matchDayId: true } });
  if (existing.some((row) => row.matchDayId !== matchDayId)) throw new Error("试训身份属于其他比赛日，请重新添加当天试训人员");
}

/** Caller removes superseded goal events first when replacing a confirmed match. */
export async function replaceTrialPlayers(tx: Prisma.TransactionClient, matchDayId: string, trials: TrialParticipant[]) {
  await assertTrialPlayerScope(tx, matchDayId, trials);
  await tx.trialPlayer.deleteMany({ where: { matchDayId, id: { notIn: trials.map((row) => row.id) } } });
  for (const { id, name, confirmed } of trials) {
    await tx.trialPlayer.upsert({ where: { id }, create: { id, matchDayId, name, confirmed }, update: { name, confirmed } });
  }
}
