import type { Prisma } from "@prisma/client";
export async function assertParticipantCorrections(
  tx: Pick<Prisma.TransactionClient, "player">,
  corrections: { rawName: string; playerId: string }[],
  assignments: { playerId: string }[],
  matchType: string
) {
  if (!corrections.length) return;
  const players = await tx.player.findMany({ select: { id: true, name: true, aliases: { select: { alias: true } } } });
  const normalized = (name: string) => name.replace(/\s+/g, "").toLowerCase();
  for (const row of corrections) {
    if (!players.some((player) => player.id === row.playerId)) throw new Error(`身份纠正的正式球员不存在：${row.rawName}`);
    if (players.some((player) => player.id !== row.playerId && [player.name, ...player.aliases.map((alias) => alias.alias)].some((name) => normalized(name) === normalized(row.rawName)))) throw new Error(`身份纠正名字已属于其他正式球员：${row.rawName}`);
  }
}
