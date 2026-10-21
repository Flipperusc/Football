import type { TrialParticipant } from "@/lib/match-events";
import { isTrialLabel } from "./automatic-trials";
import { z } from "zod";
import { parseResultSchema, type MatchedPlayer, type ParseResult, type ParsedGoalEvent } from "./schemas";
import { localParseMatch, type ParserAssignment, type ParserPlayer } from "./local-parser";
import { isDeepSeekConfigured, requestDeepSeekJson } from "./deepseek-client";
import { isOwnGoalText, parseEventAttribution } from "./event-attribution";

export type AiParseInput = {
  rawText: string;
  matchType: "INTERNAL" | "EXTERNAL";
  players: ParserPlayer[];
  teamAssignments: ParserAssignment[];
  trialPlayers?: TrialParticipant[];
};

export type AiParseOutput = {
  parsed: ParseResult;
  modelName: string;
  usedFallback: boolean;
};

type AiTeamColor = "red" | "blue" | "white" | "external";

type CleanGoal = {
  type: "goal" | "own_goal";
  isGuest: boolean;
  team?: AiTeamColor;
  scorerName: string;
  assistName?: string | null;
  count: number;
  rawText: string;
};

type CleanGame = {
  sectionNo: number;
  teamA: Exclude<AiTeamColor, "external">;
  teamB: Exclude<AiTeamColor, "external">;
  scoreA?: number;
  scoreB?: number;
  rawText: string;
  goals: CleanGoal[];
};

const aiRawGoalSchema = z.object({}).passthrough();
const aiRawGameSchema = z.object({}).passthrough();
const aiRawBonusSchema = z.object({}).passthrough();
const aiRawAwardSchema = z.object({}).passthrough();

const aiRawResultSchema = z
  .object({
    matchType: z.string().optional(),
    games: z.array(aiRawGameSchema).optional(),
    events: z.array(aiRawGoalSchema).optional(),
    goals: z.array(aiRawGoalSchema).optional(),
    bonusPoints: z.array(aiRawBonusSchema).optional(),
    bonuses: z.array(aiRawBonusSchema).optional(),
    awards: z.array(aiRawAwardSchema).optional(),
    uncertainItems: z.array(z.unknown()).optional()
  })
  .passthrough();

const schedule = [
  ["white", "blue"],
  ["white", "red"],
  ["red", "blue"],
  ["white", "blue"],
  ["white", "red"],
  ["red", "blue"]
] as const;

const chineseNumbers: Record<string, number> = {
  "\u4e00": 1,
  "\u4e8c": 2,
  "\u4e09": 3,
  "\u56db": 4,
  "\u4e94": 5,
  "\u516d": 6
};

function buildPrompt(input: AiParseInput) {
  const players = input.players.map((player) => ({
    name: player.name,
    aliases: player.aliases.map((alias) => alias.alias)
  }));

  return [
    "You are a post-match football text structuring engine. Return valid JSON only.",
    "Do not return playerId, confidence, candidates, or database-shaped objects. The backend code will match players and calculate confidence.",
    "For an internal match, return this clean shape:",
    "{\"matchType\":\"internal\",\"games\":[{\"sectionNo\":1,\"teamA\":\"white\",\"teamB\":\"blue\",\"scoreA\":0,\"scoreB\":0,\"rawText\":\"source line\",\"goals\":[{\"scorerName\":\"name\",\"assistName\":\"name or null\",\"count\":1,\"rawText\":\"source fragment\"}]}],\"bonusPoints\":[{\"playerName\":\"name\",\"points\":1,\"reason\":\"reason\",\"rawText\":\"source fragment\"}],\"awards\":[{\"name\":\"award name\",\"playerNames\":[\"name\"],\"points\":0,\"rawText\":\"source fragment\"}],\"uncertainItems\":[]}",
    "For an external match, return this clean shape:",
    "{\"matchType\":\"external\",\"events\":[{\"team\":\"external\",\"scorerName\":\"name\",\"assistName\":\"name or null\",\"count\":1,\"rawText\":\"source fragment\"}],\"bonusPoints\":[],\"awards\":[],\"uncertainItems\":[]}",
    "Use sectionNo 1-6 for internal games. Internal team colors must be red, blue, or white. External team color must be external.",
    "For ordinary internal goals the roster is the default. If the source explicitly says a player temporarily represents another team, set isGuest:true and team to the benefiting team when known. Never change the daily roster. For own goals set type:own_goal, scorerName to the player who scored into their own net, assistName:null, and team to the benefiting opponent when known. Otherwise type:goal. Do not invent a team for ambiguous substitutions; omit team and add an uncertainItem. Own goals and guest goals always require human confirmation. Preserve explicitly stated score orientation; never reverse scores to fit roster teams.",
    "Only extract facts explicitly present in the text. Do not invent goals, assists, scores, awards, or bonus points.",
    "If the text says a player gets one extra point, put it in bonusPoints with points 1.",
    "If the text says 最佳后卫 followed by one or more player names, including formats such as 最佳后卫：欧巴，果子林, put it in awards with name 最佳后卫, points 0, and all playerNames. Concatenated names can represent multiple known players, for example 最佳后卫欧巴果子林 means 欧巴 and 果之林 each receive one award count.",
    "Use the known player list only to recognize names and aliases. Keep names as text from the input.",
    `Match type: ${input.matchType}`,
    `Trial names (not formal players; no roster; preserve their event names): ${JSON.stringify(input.trialPlayers ?? [])}`,
    `Known players: ${JSON.stringify(players)}`,
    `Team assignments: ${JSON.stringify(input.teamAssignments)}`,
    `Post-match text:\n${input.rawText}`
  ].join("\n\n");
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const record = asRecord(value);
    if (record) {
      const nested = readText(
        record.rawName,
        record.name,
        record.matchedName,
        record.playerName,
        record.scorerName,
        record.assistName,
        record.reason,
        record.rawText,
        record.text,
        record.description,
        record.title
      );
      if (nested) return nested;
    }
  }
  return "";
}

function readNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeName(value: string) {
  return value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .replace(/^[,，、;；:：.\-_]+|[,，、;；:：.\-_]+$/g, "")
    .replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "");
}

function normalizeKey(value: string) {
  return normalizeName(value).toLowerCase();
}

function recordsFor(players: ParserPlayer[]) {
  return players
    .flatMap((player) => [
      { player, alias: normalizeKey(player.name), weight: 1 },
      ...player.aliases.map((alias) => ({
        player,
        alias: normalizeKey(alias.alias),
        weight: 0.96
      }))
    ])
    .filter((record) => record.alias.length > 0)
    .sort((left, right) => right.alias.length - left.alias.length);
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

function uniqueCandidates(candidates: { playerId: string; name: string; confidence: number }[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.playerId)) return false;
    seen.add(candidate.playerId);
    return true;
  });
}

function matchPlayer(rawName: string, players: ParserPlayer[]): MatchedPlayer {
  const cleanedName = normalizeName(rawName);
  const normalized = normalizeKey(cleanedName);
  const records = recordsFor(players);
  const exact = records.find((record) => record.alias === normalized);

  if (exact) {
    return {
      rawName: cleanedName,
      playerId: exact.player.id,
      matchedName: exact.player.name,
      confidence: exact.weight,
      candidates: []
    };
  }

  const candidates = uniqueCandidates(
    records
      .filter((record) => normalized.includes(record.alias) || record.alias.includes(normalized))
      .slice(0, 3)
      .map((record) => ({
        playerId: record.player.id,
        name: record.player.name,
        confidence: 0.55
      }))
  );

  const fuzzy = uniqueCandidates(
    records
      .filter((record) => isOneCharMismatch(normalized, record.alias))
      .slice(0, 3)
      .map((record) => ({
        playerId: record.player.id,
        name: record.player.name,
        confidence: 0.78
      }))
  );

  if (fuzzy.length === 1) {
    return {
      rawName: cleanedName,
      playerId: fuzzy[0].playerId,
      matchedName: fuzzy[0].name,
      confidence: 0.78,
      candidates: []
    };
  }

  return {
    rawName: cleanedName,
    playerId: candidates.length === 1 ? candidates[0].playerId : null,
    matchedName: candidates.length === 1 ? candidates[0].name : null,
    confidence: candidates.length === 1 ? 0.72 : 0.2,
    candidates
  };
}

function splitKnownPlayers(rawText: string, players: ParserPlayer[]) {
  const text = normalizeName(rawText);
  const records = recordsFor(players);
  const matched: MatchedPlayer[] = [];
  let index = 0;

  while (index < text.length) {
    const record = records.find((candidate) => {
      const segment = normalizeKey(text.slice(index, index + Array.from(candidate.alias).length));
      return segment === candidate.alias || isOneCharMismatch(segment, candidate.alias);
    });

    if (!record) {
      index += 1;
      continue;
    }

    const rawName = text.slice(index, index + Array.from(record.alias).length);
    const player = matchPlayer(rawName, players);
    if (player.playerId) {
      matched.push(player);
    }
    index += Array.from(record.alias).length;
  }

  return matched;
}

function colorFromUnknown(value: unknown): AiTeamColor | undefined {
  const text = readText(value).toLowerCase().replace(/\s+/g, "");
  if (!text) return undefined;
  if (["red", "r", "\u7ea2", "\u7ea2\u961f"].includes(text)) return "red";
  if (["blue", "b", "\u84dd", "\u84dd\u961f"].includes(text)) return "blue";
  if (["white", "w", "\u767d", "\u767d\u961f"].includes(text)) return "white";
  if (["external", "outside", "\u961f\u5916", "\u5916\u90e8"].includes(text)) return "external";
  return undefined;
}

function assignmentTeam(playerId: string | null, assignments: ParserAssignment[]) {
  if (!playerId) return undefined;
  const assignment = assignments.find((item) => item.playerId === playerId);
  return assignment?.teamColor.toLowerCase() as AiTeamColor | undefined;
}

function sectionFromUnknown(value: unknown) {
  const number = readNumber(value);
  if (number && number >= 1 && number <= 6) return Math.trunc(number);

  const text = readText(value);
  const digit = text.match(/(\d+)/);
  if (digit) {
    const parsed = Number(digit[1]);
    if (parsed >= 1 && parsed <= 6) return parsed;
  }

  const zh = text.match(/[\u7b2c]?([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d])[\u8282]?/);
  if (zh) return chineseNumbers[zh[1]];
  return undefined;
}

function scoreFromText(value: string) {
  const match = value.match(/(\d+)\s*(?::|-|\u6bd4|\uff1a)\s*(\d+)/);
  if (!match) return {};
  return { scoreA: Number(match[1]), scoreB: Number(match[2]) };
}

function scoreFromUnknown(game: Record<string, unknown>, rawText: string) {
  const directA = readNumber(game.scoreA, game.aScore, game.teamAScore);
  const directB = readNumber(game.scoreB, game.bScore, game.teamBScore);
  if (directA !== undefined || directB !== undefined) {
    return { scoreA: directA, scoreB: directB };
  }

  const score = game.score;
  if (Array.isArray(score)) {
    return { scoreA: readNumber(score[0]), scoreB: readNumber(score[1]) };
  }

  const scoreRecord = asRecord(score);
  if (scoreRecord) {
    return {
      scoreA: readNumber(scoreRecord.scoreA, scoreRecord.a, scoreRecord.left, scoreRecord.home),
      scoreB: readNumber(scoreRecord.scoreB, scoreRecord.b, scoreRecord.right, scoreRecord.away)
    };
  }

  return scoreFromText(readText(score) || rawText);
}

function normalizeGoal(rawGoal: unknown): CleanGoal | null {
  const goal = asRecord(rawGoal);
  if (!goal) return null;

  const scorerName = normalizeName(
    readText(goal.scorerName, goal.scorer, goal.playerName, goal.player, goal.goalBy)
  );
  if (!scorerName) return null;

  const assistName = normalizeName(readText(goal.assistName, goal.assist, goal.assistedBy)) || null;
  const count = Math.max(1, Math.trunc(readNumber(goal.count, goal.goals, goal.quantity) ?? 1));
  const rawText = readText(goal.rawText, goal.text, goal.description) || scorerName;

  return {
    type: goal.type === "own_goal" || goal.kind === "OWN_GOAL" || isOwnGoalText(rawText) ? "own_goal" : "goal",
    isGuest: goal.isGuest === true,
    team: colorFromUnknown(goal.team ?? goal.teamColor),
    scorerName,
    assistName,
    count,
    rawText
  };
}

function normalizeGame(rawGame: unknown, index: number): CleanGame {
  const game = asRecord(rawGame) ?? {};
  const rawText = readText(game.rawText, game.text, game.description, game.line);
  const sectionNo =
    sectionFromUnknown(game.sectionNo) ??
    sectionFromUnknown(game.section) ??
    sectionFromUnknown(game.no) ??
    sectionFromUnknown(game.index) ??
    sectionFromUnknown(rawText) ??
    index + 1;
  const scheduled = schedule[(sectionNo - 1) % schedule.length];
  const teams = asArray(game.teams);
  const teamA =
    colorFromUnknown(game.teamA) ??
    colorFromUnknown(game.leftTeam) ??
    colorFromUnknown(teams[0]) ??
    scheduled[0];
  const teamB =
    colorFromUnknown(game.teamB) ??
    colorFromUnknown(game.rightTeam) ??
    colorFromUnknown(teams[1]) ??
    scheduled[1];
  const goals = asArray(game.goals ?? game.events ?? game.goalEvents)
    .map(normalizeGoal)
    .filter((goal): goal is CleanGoal => Boolean(goal));
  const score = scoreFromUnknown(game, rawText);

  return {
    sectionNo,
    teamA: teamA === "external" ? scheduled[0] : teamA,
    teamB: teamB === "external" ? scheduled[1] : teamB,
    scoreA: score.scoreA === undefined ? undefined : Math.max(0, Math.trunc(score.scoreA)),
    scoreB: score.scoreB === undefined ? undefined : Math.max(0, Math.trunc(score.scoreB)),
    rawText,
    goals
  };
}

function countGoalsForTeam(goals: ParsedGoalEvent[], team: AiTeamColor | undefined) {
  if (!team) return 0;
  return goals.filter((goal) => goal.team === team).reduce((sum, goal) => sum + goal.count, 0);
}

function alignScoresWithAssignedGoals(game: CleanGame, events: ParsedGoalEvent[]) {
  const goalsA = countGoalsForTeam(events, game.teamA);
  const goalsB = countGoalsForTeam(events, game.teamB);
  const scoreA = game.scoreA ?? goalsA;
  const scoreB = game.scoreB ?? goalsB;

  if (goalsA <= scoreA && goalsB <= scoreB) {
    return { scoreA, scoreB };
  }

  if (goalsA <= scoreB && goalsB <= scoreA) {
    return { scoreA: scoreB, scoreB: scoreA };
  }

  return { scoreA, scoreB };
}

function matchEventParticipant(name: string, input: AiParseInput): MatchedPlayer {
  const matches = input.matchType === "INTERNAL" ? (input.trialPlayers ?? []).filter((trial) => normalizeKey(trial.name) === normalizeKey(name)) : [];
  if (matches.length === 1) return { rawName: name, playerId: null, trialPlayerId: matches[0].id, matchedName: matches[0].name, confidence: 1, candidates: [] };
  if (input.matchType === "INTERNAL" && isTrialLabel(name)) return { rawName: name, playerId: null, confidence: 0, candidates: [] };
  return matchPlayer(name, input.players);
}

function parsedGoal(goal: CleanGoal, input: AiParseInput, game?: CleanGame): ParsedGoalEvent {
  const scorer = matchEventParticipant(goal.scorerName, input);
  const ownGoal = input.matchType === "INTERNAL" && goal.type === "own_goal";
  const assist = !ownGoal && goal.assistName ? matchEventParticipant(goal.assistName, input) : null;
  const attribution = game ? parseEventAttribution({ rawText: goal.rawText, ownGoal,
    rosterTeam: assignmentTeam(scorer.playerId, input.teamAssignments), teamA: game.teamA, teamB: game.teamB,
    suggestedTeam: goal.team, guestHint: goal.isGuest }) : undefined;
  const team = input.matchType === "EXTERNAL" ? "external" : attribution?.team;
  const confidence = Math.min(
    scorer.confidence,
    assist ? assist.confidence : 1,
    team ? 1 : 0.72
  );

  return {
    type: ownGoal ? "own_goal" : "goal",
    team,
    needsTeamSelection: attribution?.needsTeamSelection,
    scorer,
    assist,
    count: goal.count,
    rawText: goal.rawText,
    confidence,
    needsReview: Boolean(attribution?.special) || !scorer.playerId || scorer.confidence < 0.75 || Boolean(assist && (!assist.playerId || assist.confidence < 0.75)) || !team
  };
}

function normalizeBonus(rawBonus: unknown, input: AiParseInput) {
  const bonus = asRecord(rawBonus);
  if (!bonus) return null;
  const playerName = normalizeName(readText(bonus.playerName, bonus.player, bonus.name));
  if (!playerName) return null;

  return {
    player: matchPlayer(playerName, input.players),
    points: Math.trunc(readNumber(bonus.points, bonus.point, bonus.score) ?? 1),
    reason: readText(bonus.reason, bonus.name, bonus.description) || "Extra point",
    rawText: readText(bonus.rawText, bonus.text, bonus.description) || playerName
  };
}

function normalizeAward(rawAward: unknown, input: AiParseInput) {
  const award = asRecord(rawAward);
  if (!award) return null;
  const name = readText(award.name, award.award, award.title) || "Award";
  const playerNames = [
    ...asArray(award.playerNames).map(readText),
    ...asArray(award.players).map(readText),
    readText(award.player)
  ]
    .map(normalizeName)
    .filter(Boolean);
  const players = playerNames.flatMap((playerName) => {
    const split = splitKnownPlayers(playerName, input.players);
    return split.length ? split : [matchPlayer(playerName, input.players)];
  });
  const bestDefender = name.includes("最佳后卫") || readText(award.rawText, award.text).includes("最佳后卫");

  return {
    name,
    players,
    points: bestDefender ? 0 : Math.trunc(readNumber(award.points, award.point) ?? 0),
    rawText: readText(award.rawText, award.text, award.description) || name
  };
}

function normalizeUncertain(rawItem: unknown) {
  const item = asRecord(rawItem);
  if (!item) {
    const text = readText(rawItem);
    return text ? { rawText: text, reason: "AI marked this item as uncertain.", candidates: [] } : null;
  }
  return {
    rawText: readText(item.rawText, item.text, item.name, item.reason) || "Uncertain item",
    reason: readText(item.reason, item.description) || "AI marked this item as uncertain.",
    candidates: []
  };
}

function playerMatchUncertain(rawText: string, player: MatchedPlayer) {
  if (player.playerId && player.confidence >= 0.75) return null;
  return {
    rawText,
    reason: "Player name could not be matched with high confidence.",
    candidates: [player]
  };
}

function fillInternalGames(games: CleanGame[]) {
  const bySection = new Map<number, CleanGame>();
  for (const game of games) {
    if (!bySection.has(game.sectionNo)) bySection.set(game.sectionNo, game);
  }

  return Array.from({ length: 6 }, (_, index) => {
    const sectionNo = index + 1;
    const existing = bySection.get(sectionNo);
    if (existing) return existing;
    const [teamA, teamB] = schedule[index];
    return {
      sectionNo,
      teamA,
      teamB,
      scoreA: 0,
      scoreB: 0,
      rawText: "",
      goals: []
    };
  });
}

function finalizeAiJson(parsedJson: unknown, input: AiParseInput): ParseResult {
  const raw = aiRawResultSchema.parse(parsedJson);
  const awards = asArray(raw.awards)
    .map((award) => normalizeAward(award, input))
    .filter((award): award is NonNullable<ReturnType<typeof normalizeAward>> => Boolean(award));
  const bonusPoints = asArray(raw.bonusPoints ?? raw.bonuses)
    .map((bonus) => normalizeBonus(bonus, input))
    .filter((bonus): bonus is NonNullable<ReturnType<typeof normalizeBonus>> => Boolean(bonus));
  const uncertainItems = asArray(raw.uncertainItems)
    .map(normalizeUncertain)
    .filter((item): item is NonNullable<ReturnType<typeof normalizeUncertain>> => Boolean(item));

  if (input.matchType === "EXTERNAL") {
    const cleanEvents = asArray(raw.events ?? raw.goals)
      .map(normalizeGoal)
      .filter((goal): goal is CleanGoal => Boolean(goal))
      .map((goal) => ({ ...goal, team: goal.team ?? "external" }));
    const events = cleanEvents.map((goal) => parsedGoal(goal, input));
    const matchUncertain = [
      ...events.flatMap((event) => [
        playerMatchUncertain(event.rawText, event.scorer),
        event.assist ? playerMatchUncertain(event.rawText, event.assist) : null
      ]),
      ...bonusPoints.map((bonus) => playerMatchUncertain(bonus.rawText, bonus.player))
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    return parseResultSchema.parse({
      matchType: "external",
      events,
      awards,
      bonusPoints,
      uncertainItems: [...uncertainItems, ...matchUncertain]
    });
  }

  const normalizedGames = fillInternalGames(asArray(raw.games).map(normalizeGame));
  const orderedScorePattern = /[红蓝白]队?\s*(?:(?:vs|对|[-—/])\s*)?[红蓝白]队?[^\d\r\n。]{0,12}\d+\s*[:：比-]\s*\d+/i;
  // When the source supplies team order, a roster conflict must never change the score.
  const sourceHasOrderedScores = orderedScorePattern.test(input.rawText);
  const games = normalizedGames.map((game) => {
    const events = game.goals.map((goal) => {
      const event = parsedGoal(goal, input, game);
      const assistTeam = event.assist
        ? assignmentTeam(event.assist.playerId, input.teamAssignments)
        : event.team;
      event.needsReview = event.needsReview
        || (event.team !== game.teamA && event.team !== game.teamB)
        || Boolean(event.assist && assistTeam !== event.team);
      return event;
    });
    const scores = sourceHasOrderedScores || orderedScorePattern.test(game.rawText)
      || events.some((event) => event.needsReview || event.type === "own_goal")
      ? { scoreA: game.scoreA ?? countGoalsForTeam(events, game.teamA), scoreB: game.scoreB ?? countGoalsForTeam(events, game.teamB) }
      : alignScoresWithAssignedGoals(game, events);
    if (countGoalsForTeam(events, game.teamA) > scores.scoreA || countGoalsForTeam(events, game.teamB) > scores.scoreB) {
      events.forEach((event) => { event.needsReview = true; });
      uncertainItems.push({ rawText: game.rawText || `第 ${game.sectionNo} 节`,
        reason: "比分与进球归属不一致，请确认得分队、事件类型或比分", candidates: [] });
    }
    return {
      sectionNo: game.sectionNo,
      teamA: game.teamA,
      teamB: game.teamB,
      scoreA: scores.scoreA,
      scoreB: scores.scoreB,
      events,
      rawText: game.rawText
    };
  });
  const allEvents = games.flatMap((game) => game.events);
  const matchUncertain = [
    ...allEvents.flatMap((event) => [
      playerMatchUncertain(event.rawText, event.scorer),
      event.assist ? playerMatchUncertain(event.rawText, event.assist) : null
    ]),
    ...bonusPoints.map((bonus) => playerMatchUncertain(bonus.rawText, bonus.player))
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return parseResultSchema.parse({
    matchType: "internal",
    games,
    awards,
    bonusPoints,
    uncertainItems: [...uncertainItems, ...matchUncertain]
  });
}

function emptyParseResult(input: AiParseInput): ParseResult {
  if (input.matchType === "EXTERNAL") {
    return parseResultSchema.parse({
      matchType: "external",
      events: [],
      awards: [],
      bonusPoints: [],
      uncertainItems: [
        {
          rawText: input.rawText,
          reason: "AI parsing failed and the local parser could not extract structured events.",
          candidates: []
        }
      ]
    });
  }

  return parseResultSchema.parse({
    matchType: "internal",
    games: fillInternalGames([]).map((game) => ({
      sectionNo: game.sectionNo,
      teamA: game.teamA,
      teamB: game.teamB,
      scoreA: game.scoreA,
      scoreB: game.scoreB,
      events: [],
      rawText: game.rawText
    })),
    awards: [],
    bonusPoints: [],
    uncertainItems: [
      {
        rawText: input.rawText,
        reason: "AI parsing failed and the local parser could not extract structured events.",
        candidates: []
      }
    ]
  });
}

function localFallback(input: AiParseInput): AiParseOutput {
  try {
    return {
      parsed: parseResultSchema.parse(localParseMatch(input)),
      modelName: "local-rule-parser",
      usedFallback: true
    };
  } catch {
    return {
      parsed: emptyParseResult(input),
      modelName: "empty-safe-parser",
      usedFallback: true
    };
  }
}

export async function parseMatchWithAi(input: AiParseInput): Promise<AiParseOutput> {
  if (!isDeepSeekConfigured()) return localFallback(input);

  const result = await requestDeepSeekJson({
    entrypoint: "match-parse",
    prompt: buildPrompt(input),
    parseContent: (content) => finalizeAiJson(JSON.parse(extractJson(content)), input)
  });

  return {
    parsed: result.parsed,
    modelName: result.modelName,
    usedFallback: false
  };
}
