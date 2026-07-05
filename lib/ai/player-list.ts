import { z } from "zod";

const aiPlayerListSchema = z.object({
  players: z.array(z.object({ name: z.string() })).default([])
});

export const playerListParseResultSchema = z.object({
  players: z.array(z.object({ name: z.string() })).default([])
});

export type PlayerListParseResult = z.infer<typeof playerListParseResultSchema>;

type PlayerListParseInput = {
  rawText: string;
};

const ignoredTokens = new Set([
  "\u7403\u5458",
  "\u961f\u5458",
  "\u59d3\u540d",
  "\u540d\u5355",
  "\u7403\u5458\u540d\u5355",
  "\u961f\u5458\u540d\u5355",
  "\u7ea2",
  "\u7ea2\u961f",
  "\u84dd",
  "\u84dd\u961f",
  "\u767d",
  "\u767d\u961f"
]);

function toHalfWidth(value: string) {
  return value.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function normalizePlayerNameForImport(value: string) {
  let name = toHalfWidth(value)
    .replace(/^\s*(?:[-*]+|\d+[.)\u3001.]|\(\d+\)|\uff08\d+\uff09)\s*/, "")
    .replace(/^\s*(?:\u7403\u5458\u540d\u5355|\u961f\u5458\u540d\u5355|\u7403\u5458|\u961f\u5458|\u59d3\u540d)\s*[:\uff1a]\s*/, "")
    .trim();

  name = name
    .replace(/\s+/g, "")
    .replace(/^[,，、;；:：.\-_]+|[,，、;；:：.\-_]+$/g, "")
    .replace(/[^\u3400-\u9fffA-Za-z0-9]/g, "");

  if (!name || /^[0-9]+$/.test(name)) return "";
  if (!/[\u3400-\u9fffA-Za-z]/.test(name)) return "";
  if (ignoredTokens.has(name)) return "";
  return name;
}

export function playerImportKey(value: string) {
  return normalizePlayerNameForImport(value).toLowerCase();
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

function splitLocalTokens(rawText: string) {
  return rawText
    .split(/[\r\n,，、;；]+/)
    .flatMap((line) => line.trim().split(/\s+/))
    .map(normalizePlayerNameForImport)
    .filter(Boolean);
}

function finalizeNames(names: string[]): PlayerListParseResult {
  const seen = new Set<string>();
  const players = names
    .map(normalizePlayerNameForImport)
    .filter(Boolean)
    .filter((name) => {
      const key = playerImportKey(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => ({ name }));

  return playerListParseResultSchema.parse({ players });
}

function localParsePlayerList(input: PlayerListParseInput) {
  return finalizeNames(splitLocalTokens(input.rawText));
}

function buildPlayerListPrompt(input: PlayerListParseInput) {
  return [
    "You are a football team player-list structuring engine. Return valid JSON only.",
    "Convert the pasted text into a structured player list.",
    "Return exactly this shape: {\"players\":[{\"name\":\"player name from input\"}]}",
    "Each player is usually on its own line. Names can contain Chinese characters and English letters, for example AD\u9499 and BOBO.",
    "Ignore headers, bullets, punctuation, blank lines, and lines that are only Arabic digits.",
    "Do not invent names. Preserve the original player name text, but remove surrounding punctuation and list numbers.",
    `Player list text:\n${input.rawText}`
  ].join("\n\n");
}

async function callDeepSeekPlayerList(input: PlayerListParseInput) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return valid JSON only. Do not return Markdown or explanation text."
        },
        {
          role: "user",
          content: buildPlayerListPrompt(input)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`DeepSeek player list parse failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek player list parse returned empty content");

  const aiRows = aiPlayerListSchema.parse(JSON.parse(extractJson(content))).players;
  return finalizeNames(aiRows.map((row) => row.name));
}

export async function parsePlayerListWithAi(input: PlayerListParseInput) {
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const parsed = await callDeepSeekPlayerList(input);
      if (parsed) {
        return {
          parsed,
          modelName: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
          usedFallback: false
        };
      }
    } catch {
      try {
        const retried = await callDeepSeekPlayerList(input);
        if (retried) {
          return {
            parsed: retried,
            modelName: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
            usedFallback: false
          };
        }
      } catch {
        // Fall back to deterministic parsing below.
      }
    }
  }

  return {
    parsed: localParsePlayerList(input),
    modelName: "local-player-list-parser",
    usedFallback: true
  };
}
