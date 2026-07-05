import type { ParseResult, ParsedGoalEvent } from "./schemas";

export type ParserPlayer = {
  id: string;
  name: string;
  aliases: { alias: string; aliasType?: string }[];
};

export type ParserAssignment = {
  teamColor: "RED" | "BLUE" | "WHITE" | "EXTERNAL";
  playerId: string;
};

const colorMap = {
  RED: "red",
  BLUE: "blue",
  WHITE: "white",
  EXTERNAL: "external"
} as const;

const schedule = [
  ["white", "blue"],
  ["white", "red"],
  ["red", "blue"],
  ["white", "blue"],
  ["white", "red"],
  ["red", "blue"]
] as const;

const chineseNumbers: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6
};

function normalizeName(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function buildNameRecords(players: ParserPlayer[]) {
  return players.flatMap((player) => [
    { player, alias: normalizeName(player.name), type: "name" },
    ...player.aliases.map((entry) => ({
      player,
      alias: normalizeName(entry.alias),
      type: entry.aliasType ?? "alias"
    }))
  ]);
}

function matchPlayer(rawName: string, players: ParserPlayer[]) {
  const normalized = normalizeName(rawName);
  const records = buildNameRecords(players).filter((record) => record.alias.length > 0);
  const exact = records.find((record) => record.alias === normalized);
  if (exact) {
    return {
      rawName,
      playerId: exact.player.id,
      matchedName: exact.player.name,
      confidence: exact.type === "name" ? 1 : 0.96,
      candidates: []
    };
  }

  const contains = records
    .filter((record) => normalized.includes(record.alias) || record.alias.includes(normalized))
    .slice(0, 3);

  if (contains.length === 1) {
    return {
      rawName,
      playerId: contains[0].player.id,
      matchedName: contains[0].player.name,
      confidence: 0.72,
      candidates: []
    };
  }

  const fuzzy = records
    .filter((record) => isOneCharMismatch(normalized, record.alias))
    .slice(0, 3);

  if (fuzzy.length === 1) {
    return {
      rawName,
      playerId: fuzzy[0].player.id,
      matchedName: fuzzy[0].player.name,
      confidence: 0.78,
      candidates: []
    };
  }

  return {
    rawName,
    playerId: null,
    matchedName: null,
    confidence: 0.2,
    candidates: contains.map((record) => ({
      playerId: record.player.id,
      name: record.player.name,
      confidence: 0.5
    }))
  };
}

function mismatchCount(left: string, right: string) {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (leftChars.length !== rightChars.length) return Number.POSITIVE_INFINITY;
  return leftChars.reduce((count, char, index) => count + (char === rightChars[index] ? 0 : 1), 0);
}

function isOneCharMismatch(left: string, right: string) {
  return Array.from(left).length >= 2 && mismatchCount(left, right) === 1;
}

function findKnownNames(text: string, players: ParserPlayer[]) {
  const records = buildNameRecords(players)
    .filter((record) => record.alias.length > 0 && text.includes(record.alias))
    .sort((a, b) => b.alias.length - a.alias.length);

  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.player.id}:${record.alias}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nearestNameBefore(text: string, index: number, players: ParserPlayer[]) {
  const records = findKnownNames(text.slice(0, index), players);
  return records
    .map((record) => ({ record, position: text.lastIndexOf(record.alias, index) }))
    .filter((item) => item.position >= 0)
    .sort((a, b) => b.position - a.position)[0]?.record;
}

function nearestNameAfter(text: string, index: number, players: ParserPlayer[]) {
  const records = findKnownNames(text.slice(index), players);
  return records
    .map((record) => ({ record, position: text.indexOf(record.alias, index) }))
    .filter((item) => item.position >= 0)
    .sort((a, b) => a.position - b.position)[0]?.record;
}

function teamForPlayer(playerId: string | null, assignments: ParserAssignment[]) {
  if (!playerId) return undefined;
  const assignment = assignments.find((entry) => entry.playerId === playerId);
  return assignment ? colorMap[assignment.teamColor] : undefined;
}

function parseSectionNo(line: string, fallback: number) {
  const digit = line.match(/第\s*(\d+)\s*节/);
  if (digit) return Number(digit[1]);
  const zh = line.match(/第\s*([一二三四五六])\s*节/);
  if (zh) return chineseNumbers[zh[1]] ?? fallback;
  return fallback;
}

function parseTeams(line: string, sectionNo: number) {
  const compact = normalizeName(line);
  if (compact.includes("白蓝")) return ["white", "blue"] as const;
  if (compact.includes("蓝白")) return ["blue", "white"] as const;
  if (compact.includes("白红")) return ["white", "red"] as const;
  if (compact.includes("红白")) return ["red", "white"] as const;
  if (compact.includes("红蓝")) return ["red", "blue"] as const;
  if (compact.includes("蓝红")) return ["blue", "red"] as const;
  return schedule[sectionNo - 1] ?? schedule[0];
}

function parseExplicitScore(line: string) {
  const score = line.match(/(\d+)\s*[:：比-]\s*(\d+)/);
  if (!score) return null;
  return [Number(score[1]), Number(score[2])] as const;
}

function eventNeedsReview(event: ParsedGoalEvent) {
  return (
    event.needsReview ||
    event.scorer.confidence < 0.75 ||
    Boolean(event.assist && event.assist.confidence < 0.75)
  );
}

function parseGoalEvents(
  line: string,
  players: ParserPlayer[],
  assignments: ParserAssignment[]
): { events: ParsedGoalEvent[]; uncertainItems: ParseResult["uncertainItems"] } {
  const events: ParsedGoalEvent[] = [];
  const uncertainItems: ParseResult["uncertainItems"] = [];

  for (const match of line.matchAll(/助攻/g)) {
    const assistRecord = nearestNameBefore(line, match.index ?? 0, players);
    const scorerRecord = nearestNameAfter(line, (match.index ?? 0) + 2, players);
    if (!assistRecord || !scorerRecord) continue;

    const rawText = `${assistRecord.alias}助攻${scorerRecord.alias}`;
    const scorer = matchPlayer(scorerRecord.alias, players);
    const assist = matchPlayer(assistRecord.alias, players);
    const hasDouble = line.slice(match.index ?? 0, (match.index ?? 0) + 18).includes("梅开二度");
    const event: ParsedGoalEvent = {
      type: "goal",
      team: teamForPlayer(scorer.playerId, assignments),
      scorer,
      assist,
      count: hasDouble ? 2 : 1,
      rawText,
      confidence: hasDouble ? 0.68 : 0.86,
      needsReview: hasDouble
    };
    event.needsReview = eventNeedsReview(event);
    events.push(event);

    if (hasDouble) {
      uncertainItems.push({
        rawText,
        reason: "文本包含梅开二度，无法确认两个进球是否均由同一名球员助攻",
        candidates: [scorer, assist]
      });
    }
  }

  for (const match of line.matchAll(/进球/g)) {
    const scorerRecord = nearestNameBefore(line, match.index ?? 0, players);
    if (!scorerRecord) continue;
    const alreadyCovered = events.some((event) => event.scorer.rawName === scorerRecord.alias);
    if (alreadyCovered) continue;

    const scorer = matchPlayer(scorerRecord.alias, players);
    const event: ParsedGoalEvent = {
      type: "goal",
      team: teamForPlayer(scorer.playerId, assignments),
      scorer,
      assist: null,
      count: 1,
      rawText: `${scorerRecord.alias}进球`,
      confidence: 0.82,
      needsReview: scorer.confidence < 0.75
    };
    events.push(event);
  }

  return { events, uncertainItems };
}

function countGoalsByTeam(events: ParsedGoalEvent[], team: string) {
  return events
    .filter((event) => event.team === team)
    .reduce((sum, event) => sum + event.count, 0);
}

function parseBonusPoints(line: string, players: ParserPlayer[]) {
  if (!/加\s*(一|1)\s*分?/.test(line)) return [];
  return findKnownNames(line, players)
    .filter((record) => line.indexOf(record.alias) <= line.search(/加\s*(一|1)\s*分?/))
    .slice(-1)
    .map((record) => ({
      player: matchPlayer(record.alias, players),
      points: 1,
      reason: "赛后文本提到加一分",
      rawText: line
    }));
}

function splitKnownPlayers(rawText: string, players: ParserPlayer[]) {
  const text = normalizeName(rawText);
  const records = buildNameRecords(players)
    .filter((record) => record.alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length);
  const matched: ReturnType<typeof matchPlayer>[] = [];
  let index = 0;

  while (index < text.length) {
    const record = records.find((candidate) => {
      const segment = text.slice(index, index + candidate.alias.length);
      return segment === candidate.alias || isOneCharMismatch(segment, candidate.alias);
    });

    if (!record) {
      index += 1;
      continue;
    }

    const rawName = text.slice(index, index + record.alias.length);
    const player = matchPlayer(rawName, players);
    if (player.playerId) {
      matched.push(player);
    }
    index += record.alias.length;
  }

  return matched;
}

function parseAwards(line: string, players: ParserPlayer[]) {
  const bestDefender = "\u6700\u4f73\u540e\u536b";
  const index = line.indexOf(bestDefender);
  if (index < 0) return [];

  const rawPlayers = line
    .slice(index + bestDefender.length)
    .replace(/[：:，,、\s]/g, "");

  return [
    {
      name: bestDefender,
      players: splitKnownPlayers(rawPlayers, players),
      points: 1,
      rawText: line
    }
  ];
}

export function localParseMatch(input: {
  rawText: string;
  matchType: "INTERNAL" | "EXTERNAL";
  players: ParserPlayer[];
  teamAssignments: ParserAssignment[];
}): ParseResult {
  const lines = input.rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bonusPoints = lines.flatMap((line) => parseBonusPoints(line, input.players));
  const awards = lines.flatMap((line) => parseAwards(line, input.players));

  if (input.matchType === "EXTERNAL") {
    const parsed = lines.flatMap((line) =>
      parseGoalEvents(line, input.players, input.teamAssignments).events
    );
    return {
      matchType: "external",
      events: parsed,
      awards,
      bonusPoints,
      uncertainItems: parsed
        .filter((event) => event.needsReview)
        .map((event) => ({
          rawText: event.rawText,
          reason: "球员匹配置信度较低，需要人工确认",
          candidates: [event.scorer, ...(event.assist ? [event.assist] : [])]
        }))
    };
  }

  const uncertainItems: ParseResult["uncertainItems"] = [];
  const games = lines
    .filter((line) => /第\s*([一二三四五六\d]+)\s*节/.test(line))
    .map((line, index) => {
      const sectionNo = parseSectionNo(line, index + 1);
      const [teamA, teamB] = parseTeams(line, sectionNo);
      const { events, uncertainItems: lineUncertain } = parseGoalEvents(
        line,
        input.players,
        input.teamAssignments
      );
      uncertainItems.push(...lineUncertain);
      const explicitScore = parseExplicitScore(line);
      const scoreA = explicitScore?.[0] ?? countGoalsByTeam(events, teamA);
      const scoreB = explicitScore?.[1] ?? countGoalsByTeam(events, teamB);

      return {
        sectionNo,
        teamA,
        teamB,
        scoreA,
        scoreB,
        events,
        rawText: line
      };
    });

  return {
    matchType: "internal",
    games,
    awards,
    bonusPoints,
    uncertainItems: [
      ...uncertainItems,
      ...games.flatMap((game) =>
        game.events
          .filter((event) => event.needsReview)
          .map((event) => ({
            rawText: event.rawText,
            reason: "球员匹配置信度较低，需要人工确认",
            candidates: [event.scorer, ...(event.assist ? [event.assist] : [])]
          }))
      )
    ]
  };
}
