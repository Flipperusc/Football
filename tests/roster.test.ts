import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRosterImageWithAi, parseRosterWithAi } from "@/lib/ai/roster";
import type { ParserPlayer } from "@/lib/ai/local-parser";

const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const previousDeepSeekMaxTokens = process.env.DEEPSEEK_MAX_TOKENS;

const rosterNames = {
  RED: [
    "\u679c\u4e4b\u6797",
    "\u6b27\u5df4",
    "\u5341\u4e09",
    "\u96ea\u5b50",
    "\u5c0f\u4f55",
    "\u9053\u957f",
    "\u8d39\u5bb6\u5bb6",
    "\u5c0f\u738b"
  ],
  BLUE: [
    "\u8096\u8001\u5e08",
    "\u9648\u5c11",
    "\u4fca\u951f",
    "\u5218\u5fd7",
    "\u61c2\u4e8b\u957f",
    "\u5b87\u54e5",
    "\u66fe\u7426",
    "\u4e07\u65b0"
  ],
  WHITE: [
    "\u6e38\u8001\u5e08",
    "\u67f3\u65ed",
    "\u96f7\u5dde",
    "\u9676\u9676",
    "\u5468\u6770",
    "\u5927\u5723",
    "\u725b\u54e5",
    "\u5f20\u4eae"
  ]
} as const;

function buildPlayers(): ParserPlayer[] {
  return Object.values(rosterNames)
    .flat()
    .map((name, index) => ({
      id: `p${index + 1}`,
      name,
      aliases: []
    }));
}

function namesForTeam(
  assignments: Awaited<ReturnType<typeof parseRosterWithAi>>["parsed"]["assignments"],
  teamColor: keyof typeof rosterNames
) {
  return assignments.filter((row) => row.teamColor === teamColor).map((row) => row.matchedName);
}

function rolesForTeam(
  assignments: Awaited<ReturnType<typeof parseRosterWithAi>>["parsed"]["assignments"],
  teamColor: keyof typeof rosterNames
) {
  return assignments.filter((row) => row.teamColor === teamColor).map((row) => row.role);
}

describe("roster parsing", () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (previousDeepSeekKey) {
      process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
    } else {
      delete process.env.DEEPSEEK_API_KEY;
    }
    if (previousDeepSeekMaxTokens) {
      process.env.DEEPSEEK_MAX_TOKENS = previousDeepSeekMaxTokens;
    } else {
      delete process.env.DEEPSEEK_MAX_TOKENS;
    }
  });

  it("ignores Arabic digits and marks the last Chinese player in each internal team as goalkeeper", async () => {
    const rawText = [
      "\u7ea2",
      ...rosterNames.RED.slice(0, -1),
      "10",
      rosterNames.RED[rosterNames.RED.length - 1],
      "\u84dd",
      ...rosterNames.BLUE.slice(0, -1),
      "10",
      rosterNames.BLUE[rosterNames.BLUE.length - 1],
      "\u767d",
      ...rosterNames.WHITE.slice(0, -1),
      "10",
      rosterNames.WHITE[rosterNames.WHITE.length - 1]
    ].join("\n");

    const result = await parseRosterWithAi({
      rawText,
      matchType: "INTERNAL",
      players: buildPlayers()
    });

    expect(result.usedFallback).toBe(true);
    expect(result.parsed.assignments).toHaveLength(24);
    expect(result.parsed.assignments.map((row) => row.rawName)).not.toContain("10");
    expect(namesForTeam(result.parsed.assignments, "RED")).toEqual(rosterNames.RED);
    expect(namesForTeam(result.parsed.assignments, "BLUE")).toEqual(rosterNames.BLUE);
    expect(namesForTeam(result.parsed.assignments, "WHITE")).toEqual(rosterNames.WHITE);
    expect(rolesForTeam(result.parsed.assignments, "RED")).toEqual([
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "GOALKEEPER"
    ]);
    expect(rolesForTeam(result.parsed.assignments, "BLUE")).toEqual([
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "GOALKEEPER"
    ]);
    expect(rolesForTeam(result.parsed.assignments, "WHITE")).toEqual([
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "PLAYER",
      "GOALKEEPER"
    ]);
  });

  it("keeps a matched player in only one internal team and flags conflicting OCR", async () => {
    const repeatedName = rosterNames.RED[0];
    const result = await parseRosterWithAi({
      rawText: `红\n${repeatedName}\n蓝\n${repeatedName}`,
      matchType: "INTERNAL",
      players: buildPlayers()
    });

    expect(result.parsed.assignments).toHaveLength(1);
    expect(result.parsed.assignments[0]).toMatchObject({
      teamColor: "RED",
      matchedName: repeatedName
    });
    expect(result.parsed.uncertainItems).toEqual([
      expect.objectContaining({
        rawText: repeatedName,
        reason: "同一球员被识别到多个分队，已保留首次分队，请人工检查。"
      })
    ]);
  });

  it("uses non-thinking mode and the configured output limit for DeepSeek roster parsing", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_MAX_TOKENS = "4096";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  assignments: [
                    { teamColor: "RED", role: "PLAYER", rawName: rosterNames.RED[0] }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseRosterWithAi({
      rawText: `红\n${rosterNames.RED[0]}`,
      matchType: "INTERNAL",
      players: buildPlayers()
    });

    expect(result.usedFallback).toBe(false);
    const requestBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody.max_tokens).toBe(4096);
  });

  it("uses the current DeepSeek Flash vision model without inferring a goalkeeper when the image has no marker", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const ocrText = `红\n${rosterNames.RED[0]}\n${rosterNames.RED[1]}`;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  rawText: ocrText,
                  assignments: [
                    { teamColor: "RED", role: "PLAYER", rawName: rosterNames.RED[0] },
                    { teamColor: "RED", role: "GOALKEEPER", rawName: rosterNames.RED[1] }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseRosterImageWithAi({
      imageDataUrl,
      players: buildPlayers()
    });

    expect(result).toMatchObject({
      ocrText,
      modelName: "deepseek-flash",
      usedFallback: false
    });
    expect(result.parsed.assignments.map((row) => row.matchedName)).toEqual([
      rosterNames.RED[0],
      rosterNames.RED[1]
    ]);
    expect(result.parsed.assignments.map((row) => row.role)).toEqual([
      "PLAYER",
      "PLAYER"
    ]);

    const requestBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(requestBody.model).toBe("deepseek-flash");
    expect(requestBody.messages[1].content).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "image_url", image_url: { url: imageDataUrl } }
    ]);
  });

  it("keeps an image goalkeeper only when the OCR text explicitly labels the player", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const ocrText = `红\nGK ${rosterNames.RED[0]}\n${rosterNames.RED[1]}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    rawText: ocrText,
                    assignments: [
                      { teamColor: "RED", role: "PLAYER", rawName: rosterNames.RED[0] },
                      { teamColor: "RED", role: "GOALKEEPER", rawName: rosterNames.RED[1] }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const result = await parseRosterImageWithAi({
      imageDataUrl,
      players: buildPlayers()
    });

    expect(result.parsed.assignments.map((row) => row.role)).toEqual([
      "GOALKEEPER",
      "PLAYER"
    ]);
  });
});
