import { z } from "zod";
import { isTrialLabel } from "./automatic-trials";
import type { ParserPlayer } from "./local-parser";
import { isDeepSeekConfigured, requestDeepSeekJson } from "./deepseek-client";

const rosterTeamColorSchema = z.enum(["RED", "BLUE", "WHITE", "EXTERNAL"]);
const rosterRoleSchema = z.enum(["PLAYER", "GOALKEEPER"]);

const rosterCandidateSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  confidence: z.number().min(0).max(1)
});

const rosterAssignmentSchema = z.object({
  teamColor: rosterTeamColorSchema,
  role: rosterRoleSchema.default("PLAYER"),
  rawName: z.string(),
  playerId: z.string().nullable(),
  matchedName: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  candidates: z.array(rosterCandidateSchema).default([]),
  needsReview: z.boolean().default(false)
});

export const rosterParseResultSchema = z.object({
  assignments: z.array(rosterAssignmentSchema).default([]),
  uncertainItems: z
    .array(
      z.object({
        rawText: z.string(),
        reason: z.string(),
        candidates: z.array(rosterCandidateSchema).default([])
      })
    )
    .default([])
});

export type RosterParseResult = z.infer<typeof rosterParseResultSchema>;
export type RosterAssignment = z.infer<typeof rosterAssignmentSchema>;

type RosterParseInput = {
  rawText: string;
  matchType: "INTERNAL" | "EXTERNAL";
  players: ParserPlayer[];
};

type RosterImageParseInput = {
  imageDataUrl: string;
  players: ParserPlayer[];
};

type AiRosterRow = {
  teamColor: "RED" | "BLUE" | "WHITE" | "EXTERNAL";
  role: "PLAYER" | "GOALKEEPER";
  rawName: string;
};

type InternalGoalkeeperPolicy = "LAST_IN_TEAM" | "EXPLICIT_ONLY";

const aiRosterResultSchema = z.object({
  assignments: z
    .array(
      z.object({
        teamColor: rosterTeamColorSchema,
        role: rosterRoleSchema.default("PLAYER"),
        rawName: z.string()
      })
    )
    .default([])
});

const aiRosterImageResultSchema = aiRosterResultSchema.extend({
  rawText: z.string().trim().min(1).max(20_000)
});

const DEEPSEEK_ROSTER_VISION_MODEL = "deepseek-flash";

const teamPrefixMatchers: { teamColor: AiRosterRow["teamColor"]; pattern: RegExp }[] = [
  { teamColor: "RED", pattern: /^\s*(?:\u7ea2\u961f?|\bred\b)\s*[:\uFF1A,，、;\s-]*/i },
  { teamColor: "BLUE", pattern: /^\s*(?:\u84dd\u961f?|\bblue\b)\s*[:\uFF1A,，、;\s-]*/i },
  { teamColor: "WHITE", pattern: /^\s*(?:\u767d\u961f?|\bwhite\b)\s*[:\uFF1A,，、;\s-]*/i }
];

const ignoredChineseTokens = new Set([
  "\u7ea2",
  "\u7ea2\u961f",
  "\u84dd",
  "\u84dd\u961f",
  "\u767d",
  "\u767d\u961f",
  "\u95e8\u5c06",
  "\u5b88\u95e8\u5458",
  "\u961f\u957f",
  "\u66ff\u8865"
]);

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

function removeArabicDigits(value: string) {
  return value.replace(/[0-9\uFF10-\uFF19]/g, "");
}

function chineseOnly(value: string) {
  return Array.from(removeArabicDigits(value).matchAll(/[\u3400-\u9fff]+/g))
    .map((match) => match[0])
    .join("");
}

function sanitizePersonName(value: string) {
  let name = chineseOnly(value)
    .replace(/^(\u95e8\u5c06|\u5b88\u95e8\u5458|\u961f\u957f|\u66ff\u8865)/, "")
    .trim();
  if (ignoredChineseTokens.has(name)) return "";
  return name;
}

function normalize(value: string) {
  return sanitizePersonName(value).replace(/\s+/g, "");
}

function recordsFor(players: ParserPlayer[]) {
  return players
    .flatMap((player) => [
      { player, alias: normalize(player.name), weight: 1 },
      ...player.aliases.map((alias) => ({
        player,
        alias: normalize(alias.alias),
        weight: 0.96
      }))
    ])
    .filter((record) => record.alias.length > 0)
    .sort((left, right) => right.alias.length - left.alias.length);
}

function uniqueCandidates(candidates: { playerId: string; name: string; confidence: number }[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.playerId)) return false;
    seen.add(candidate.playerId);
    return true;
  });
}

function matchRawName(rawName: string, players: ParserPlayer[]) {
  const value = normalize(rawName);
  const records = recordsFor(players);
  const exact = records.find((record) => record.alias === value);
  if (exact) {
    return {
      playerId: exact.player.id,
      matchedName: exact.player.name,
      confidence: exact.weight,
      candidates: []
    };
  }

  if (isTrialLabel(rawName)) return { playerId: null, matchedName: null, confidence: 0, candidates: [] };

  const candidates = uniqueCandidates(
    records
      .filter((record) => value.includes(record.alias) || record.alias.includes(value))
      .slice(0, 3)
      .map((record) => ({
        playerId: record.player.id,
        name: record.player.name,
        confidence: 0.55
      }))
  );

  return {
    playerId: candidates.length === 1 ? candidates[0].playerId : null,
    matchedName: candidates.length === 1 ? candidates[0].name : null,
    confidence: candidates.length === 1 ? 0.72 : 0.2,
    candidates
  };
}

function applyInternalGoalkeeperRule(
  assignments: RosterAssignment[],
  matchType: RosterParseInput["matchType"],
  policy: InternalGoalkeeperPolicy
): RosterAssignment[] {
  if (matchType !== "INTERNAL") return assignments;
  if (policy === "EXPLICIT_ONLY") return assignments;

  const lastIndexByTeam = new Map<"RED" | "BLUE" | "WHITE", number>();
  assignments.forEach((assignment, index) => {
    if (assignment.teamColor === "RED" || assignment.teamColor === "BLUE" || assignment.teamColor === "WHITE") {
      lastIndexByTeam.set(assignment.teamColor, index);
    }
  });

  return assignments.map((assignment, index) => {
    if (assignment.teamColor !== "RED" && assignment.teamColor !== "BLUE" && assignment.teamColor !== "WHITE") {
      return assignment;
    }
    return {
      ...assignment,
      role: lastIndexByTeam.get(assignment.teamColor) === index ? "GOALKEEPER" : "PLAYER"
    };
  });
}

function consumeTeamPrefix(line: string) {
  for (const matcher of teamPrefixMatchers) {
    const match = line.match(matcher.pattern);
    if (match) {
      return {
        teamColor: matcher.teamColor,
        rest: line.slice(match[0].length)
      };
    }
  }
  return null;
}

function splitChineseNames(line: string) {
  const withoutDigits = removeArabicDigits(line);
  const names = withoutDigits.match(/[\u3400-\u9fff]+/g) ?? [];
  return names.map(sanitizePersonName).filter(Boolean);
}

function roleAndRest(line: string): { role: AiRosterRow["role"]; rest: string } {
  const goalkeeperPrefix = /^\s*(?:\u95e8\u5c06|\u5b88\u95e8\u5458|gk)\s*[:\uFF1A,，、;\s-]*/i;
  const match = line.match(goalkeeperPrefix);
  if (!match) return { role: "PLAYER", rest: line };
  return { role: "GOALKEEPER", rest: line.slice(match[0].length) };
}

function localRows(input: RosterParseInput): AiRosterRow[] {
  const rows: AiRosterRow[] = [];
  let currentTeam: AiRosterRow["teamColor"] = input.matchType === "EXTERNAL" ? "EXTERNAL" : "RED";

  for (const rawLine of input.rawText.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;

    const teamPrefix = input.matchType === "INTERNAL" ? consumeTeamPrefix(line) : null;
    if (teamPrefix) {
      currentTeam = teamPrefix.teamColor;
      line = teamPrefix.rest.trim();
      if (!line) continue;
    }

    if (!chineseOnly(line)) continue;

    const roleInfo = roleAndRest(line);
    const names = splitChineseNames(roleInfo.rest);
    for (const rawName of names) {
      rows.push({
        teamColor: currentTeam,
        role: roleInfo.role,
        rawName
      });
    }
  }

  return rows;
}

function goalkeeperEvidenceKey(row: AiRosterRow, players: ParserPlayer[]) {
  const matched = matchRawName(row.rawName, players);
  return matched.playerId
    ? `${row.teamColor}:player:${matched.playerId}`
    : `${row.teamColor}:name:${normalize(row.rawName)}`;
}

function applyExplicitImageGoalkeeperEvidence(
  rows: AiRosterRow[],
  input: RosterParseInput
): AiRosterRow[] {
  const explicitGoalkeepers = new Set(
    localRows(input)
      .filter((row) => row.role === "GOALKEEPER")
      .map((row) => goalkeeperEvidenceKey(row, input.players))
  );

  return rows.map((row) => ({
    ...row,
    role: explicitGoalkeepers.has(goalkeeperEvidenceKey(row, input.players))
      ? "GOALKEEPER"
      : "PLAYER"
  }));
}

function finalizeRows(
  rows: AiRosterRow[],
  input: RosterParseInput,
  goalkeeperPolicy: InternalGoalkeeperPolicy = "LAST_IN_TEAM"
): RosterParseResult {
  const assignments: RosterAssignment[] = [];
  const uncertainItems: RosterParseResult["uncertainItems"] = [];
  const seen = new Set<string>();
  const internalTeamByPlayer = new Map<string, "RED" | "BLUE" | "WHITE">();

  for (const row of rows) {
    const rawName = sanitizePersonName(row.rawName);
    if (!rawName) continue;

    const teamColor = input.matchType === "EXTERNAL" ? "EXTERNAL" : row.teamColor;
    if (input.matchType === "INTERNAL" && teamColor === "EXTERNAL") continue;

    const matched = matchRawName(rawName, input.players);
    if (input.matchType === "INTERNAL" && matched.playerId) {
      const previousTeam = internalTeamByPlayer.get(matched.playerId);
      if (previousTeam && previousTeam !== teamColor) {
        uncertainItems.push({
          rawText: rawName,
          reason: "同一球员被识别到多个分队，已保留首次分队，请人工检查。",
          candidates: [
            {
              playerId: matched.playerId,
              name: matched.matchedName ?? rawName,
              confidence: matched.confidence
            }
          ]
        });
        continue;
      }
      if (teamColor !== "EXTERNAL") internalTeamByPlayer.set(matched.playerId, teamColor);
    }
    const key = `${teamColor}:${matched.playerId ?? rawName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const finalized: RosterAssignment = {
      teamColor,
      role: row.role,
      rawName,
      playerId: matched.playerId,
      matchedName: matched.matchedName,
      confidence: matched.confidence,
      candidates: matched.candidates,
      needsReview: !matched.playerId || matched.confidence < 0.75
    };

    assignments.push(finalized);
    if (finalized.needsReview) {
      uncertainItems.push({
        rawText: rawName,
        reason: "Unable to match this Chinese name to a known player with high confidence.",
        candidates: finalized.candidates
      });
    }
  }

  return {
    assignments: applyInternalGoalkeeperRule(assignments, input.matchType, goalkeeperPolicy),
    uncertainItems
  };
}

function localParseRoster(input: RosterParseInput): RosterParseResult {
  return finalizeRows(localRows(input), input);
}

function buildRosterPrompt(input: RosterParseInput) {
  const playerList = input.players.map((player) => ({
    name: player.name,
    aliases: player.aliases.map((alias) => alias.alias)
  }));

  return [
    "You are a roster structuring engine. Return valid JSON only.",
    "Your task is to convert the user's roster text into structured rows that code can fill into a form.",
    "Return exactly this shape: {\"assignments\":[{\"teamColor\":\"RED|BLUE|WHITE|EXTERNAL\",\"role\":\"PLAYER|GOALKEEPER\",\"rawName\":\"Chinese name from input\"}]}",
    "Critical rule: ignore all Arabic digits completely, including 0-9 and full-width digits. Digits are never player names, jersey numbers, team names, or goalkeeper markers.",
    "Only Chinese text can become rawName. rawName must contain Chinese characters only. Strip spaces, punctuation, colons, commas, and digits.",
    "Do not infer GOALKEEPER from a digit line such as 10. For INTERNAL matches, the last valid player name under each team is the goalkeeper.",
    "For INTERNAL matches, use section headers: \\u7ea2 or \\u7ea2\\u961f means RED, \\u84dd or \\u84dd\\u961f means BLUE, \\u767d or \\u767d\\u961f means WHITE.",
    "For EXTERNAL matches, every player row must use teamColor EXTERNAL.",
    "Do not output team color words, role words, punctuation, or numbers as players.",
    "Use the known player list only to help identify names and aliases. Do not invent names that are not present in the roster text.",
    `Match type: ${input.matchType}`,
    `Known players: ${JSON.stringify(playerList)}`,
    `Roster text:\n${input.rawText}`
  ].join("\n\n");
}

function buildRosterImagePrompt(players: ParserPlayer[]) {
  const playerList = players.map((player) => ({
    name: player.name,
    aliases: player.aliases.map((alias) => alias.alias)
  }));

  return [
    "You are an OCR and roster-structuring engine for one Chinese internal football match roster image. Return valid JSON only.",
    "Read the image layout, headings, columns, labels, and Chinese names. Identify which visible names belong to RED, BLUE, or WHITE.",
    "Return exactly this shape: {\"rawText\":\"normalized OCR text\",\"assignments\":[{\"teamColor\":\"RED|BLUE|WHITE\",\"role\":\"PLAYER|GOALKEEPER\",\"rawName\":\"Chinese name from image\"}]}",
    "rawText must be editable normalized roster text ordered as red team, blue team, then white team, with a team heading and one visible name per line.",
    "Preserve an explicitly visible GK, 门将, or 守门员 label in rawText on the same line as its player, normalized as 'GK 姓名'. Never add a goalkeeper label that is not visible in the image.",
    "Ignore scores, dates, times, jersey numbers, chat messages, watermarks, and other non-roster content. Never treat a number as a player.",
    "Only include a person if the name is visibly present in the image. Do not invent or move a player between teams.",
    "Use the known player names and aliases only to correct visually plausible OCR characters; never use them to add a player who is not visible.",
    "Set role GOALKEEPER only when GK, 门将, or 守门员 is visibly associated with that exact player in the image. Otherwise set role PLAYER.",
    "Never infer a goalkeeper from player order, the last name in a team, a jersey number, a known player position, or football conventions. If the image has no explicit goalkeeper label, every assignment must use role PLAYER.",
    `Known players: ${JSON.stringify(playerList)}`
  ].join("\n\n");
}

export async function parseRosterWithAi(input: RosterParseInput) {
  if (!isDeepSeekConfigured()) {
    return {
      parsed: rosterParseResultSchema.parse(localParseRoster(input)),
      modelName: "local-roster-parser",
      usedFallback: true
    };
  }

  const result = await requestDeepSeekJson({
    entrypoint: "roster-parse",
    prompt: buildRosterPrompt(input),
    parseContent: (content) => {
      const aiRows = aiRosterResultSchema.parse(JSON.parse(extractJson(content))).assignments;
      return rosterParseResultSchema.parse(finalizeRows(aiRows, input));
    }
  });

  return {
    parsed: result.parsed,
    modelName: result.modelName,
    usedFallback: false
  };
}

export async function parseRosterImageWithAi(input: RosterImageParseInput) {
  const prompt = buildRosterImagePrompt(input.players);
  const result = await requestDeepSeekJson({
    entrypoint: "roster-image-ocr",
    model: DEEPSEEK_ROSTER_VISION_MODEL,
    prompt,
    userContent: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: input.imageDataUrl } }
    ],
    parseContent: (content) => {
      const imageResult = aiRosterImageResultSchema.parse(JSON.parse(extractJson(content)));
      const rosterInput: RosterParseInput = {
        rawText: imageResult.rawText,
        matchType: "INTERNAL",
        players: input.players
      };
      const rows = imageResult.assignments.length
        ? imageResult.assignments
        : localRows(rosterInput);
      const rowsWithVerifiedGoalkeepers = applyExplicitImageGoalkeeperEvidence(rows, rosterInput);

      return {
        ocrText: imageResult.rawText,
        parsed: rosterParseResultSchema.parse(
          finalizeRows(rowsWithVerifiedGoalkeepers, rosterInput, "EXPLICIT_ONLY")
        )
      };
    }
  });

  return {
    ...result.parsed,
    modelName: result.modelName,
    usedFallback: false
  };
}
