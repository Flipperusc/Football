export type SearchablePlayer = {
  name: string;
  aliases?: { alias: string }[];
};

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export function filterPlayersByName<T extends SearchablePlayer>(players: T[], query: string) {
  const keyword = normalizeSearchText(query);
  if (!keyword) return players;

  return players.filter((player) =>
    [player.name, ...(player.aliases ?? []).map((alias) => alias.alias)].some((value) =>
      normalizeSearchText(value).includes(keyword)
    )
  );
}
