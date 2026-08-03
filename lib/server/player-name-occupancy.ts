import { playerImportKey } from "@/lib/ai/player-list";

export type PlayerNameSource = {
  id: string;
  name: string;
  aliases: { id?: string; alias: string }[];
};

export type PlayerNameConflict =
  | {
      kind: "PLAYER_NAME";
      playerId: string;
      playerName: string;
      value: string;
    }
  | {
      kind: "ALIAS";
      playerId: string;
      playerName: string;
      value: string;
      aliasId?: string;
    };

export type PlayerNameOccupancyOptions = {
  excludeStandardNameOfPlayerId?: string;
};

export function buildPlayerNameOccupancy(
  players: PlayerNameSource[],
  options: PlayerNameOccupancyOptions = {}
) {
  const lookup = new Map<string, PlayerNameConflict>();

  for (const player of players) {
    if (player.id === options.excludeStandardNameOfPlayerId) continue;
    const key = playerImportKey(player.name);
    if (!key || lookup.has(key)) continue;
    lookup.set(key, {
      kind: "PLAYER_NAME",
      playerId: player.id,
      playerName: player.name,
      value: player.name
    });
  }

  for (const player of players) {
    for (const alias of player.aliases) {
      const key = playerImportKey(alias.alias);
      if (!key || lookup.has(key)) continue;
      lookup.set(key, {
        kind: "ALIAS",
        playerId: player.id,
        playerName: player.name,
        value: alias.alias,
        aliasId: alias.id
      });
    }
  }

  return lookup;
}

export function findPlayerNameConflict(
  name: string,
  players: PlayerNameSource[],
  options: PlayerNameOccupancyOptions = {}
) {
  const key = playerImportKey(name);
  if (!key) return null;
  return buildPlayerNameOccupancy(players, options).get(key) ?? null;
}

export function formatPlayerNameConflict(
  subject: "球员名称" | "别名",
  submittedName: string,
  conflict: PlayerNameConflict
) {
  if (conflict.kind === "ALIAS") {
    return `${subject}“${submittedName}”已被球员“${conflict.playerName}”用作别名“${conflict.value}”`;
  }

  return `${subject}“${submittedName}”与已有球员“${conflict.playerName}”的名称重复`;
}
