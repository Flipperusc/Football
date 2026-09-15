import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekError } from "@/lib/ai/deepseek-client";

const mocks = vi.hoisted(() => {
  const db = {
    matchDay: {
      findUnique: vi.fn(),
      updateMany: vi.fn()
    },
    player: {
      findMany: vi.fn()
    },
    matchParseResult: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  };

  return {
    db,
    parseMatchWithAi: vi.fn()
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/ai/deepseek", () => ({ parseMatchWithAi: mocks.parseMatchWithAi }));

import { POST } from "@/app/api/matchdays/[id]/parse/route";

function parseRequest(
  matchType: "INTERNAL" | "EXTERNAL" = "INTERNAL",
  teamAssignments: { playerId: string; teamColor: "RED" | "BLUE" | "WHITE" | "EXTERNAL" }[] = []
) {
  return new Request("http://localhost/api/matchdays/m1/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rawText: "第一节白蓝1:0",
      matchType,
      teamAssignments
    })
  });
}

function successfulParse() {
  return {
    parsed: {
      matchType: "internal" as const,
      games: [],
      awards: [],
      bonusPoints: [],
      uncertainItems: []
    },
    modelName: "deepseek-test",
    usedFallback: false
  };
}

describe("match parse route consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.matchDay.findUnique.mockResolvedValue({
      id: "m1",
      type: "INTERNAL",
      assignments: [{ playerId: "p1", teamColor: "WHITE", role: "PLAYER", isCaptain: false }]
    });
    mocks.db.matchDay.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.player.findMany.mockResolvedValue([]);
    mocks.db.matchParseResult.create.mockResolvedValue({ id: "parse-1" });
    mocks.db.$transaction.mockImplementation(
      async (run: (tx: typeof mocks.db) => Promise<unknown>) => run(mocks.db)
    );
    mocks.parseMatchWithAi.mockResolvedValue(successfulParse());
  });

  it("returns 404 before calling AI when the match does not exist", async () => {
    mocks.db.matchDay.findUnique.mockResolvedValue(null);

    const response = await POST(parseRequest(), { params: { id: "missing" } });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      message: "比赛记录不存在或已被删除。",
      code: "MATCH_DAY_NOT_FOUND"
    });
    expect(mocks.parseMatchWithAi).not.toHaveBeenCalled();
    expect(mocks.db.player.findMany).not.toHaveBeenCalled();
  });

  it("returns 409 before calling AI when the match type differs", async () => {
    mocks.db.matchDay.findUnique.mockResolvedValue({ id: "m1", type: "EXTERNAL" });

    const response = await POST(parseRequest("INTERNAL"), { params: { id: "m1" } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "MATCH_TYPE_MISMATCH" });
    expect(mocks.parseMatchWithAi).not.toHaveBeenCalled();
  });

  it("uses persisted roster assignments instead of request-provided teams", async () => {
    const response = await POST(
      parseRequest("INTERNAL", [{ playerId: "p1", teamColor: "RED" }]),
      { params: { id: "m1" } }
    );

    expect(response.status).toBe(200);
    expect(mocks.parseMatchWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        teamAssignments: [
          { playerId: "p1", teamColor: "WHITE", role: "PLAYER", isCaptain: false }
        ]
      })
    );
  });

  it("does not create an orphan result when the match is deleted during a successful parse", async () => {
    mocks.db.matchDay.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(parseRequest(), { params: { id: "m1" } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MATCH_DAY_DELETED_DURING_PARSE"
    });
    expect(mocks.parseMatchWithAi).toHaveBeenCalledOnce();
    expect(mocks.db.matchParseResult.create).not.toHaveBeenCalled();
  });

  it("records a failed result and returns the exact Chinese 504 timeout contract", async () => {
    mocks.parseMatchWithAi.mockRejectedValue(
      new DeepSeekError({
        code: "AI_TIMEOUT",
        message: "DeepSeek 响应等待超时，请稍后重试。",
        status: 504,
        retryable: true
      })
    );

    const response = await POST(parseRequest(), { params: { id: "m1" } });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      message: "DeepSeek 解析等待超时。比赛信息已经保存，请点击“重新解析”再次尝试。",
      code: "AI_TIMEOUT"
    });
    expect(mocks.db.matchDay.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", type: "INTERNAL" },
      data: { rawText: "第一节白蓝1:0", parseStatus: "FAILED" }
    });
    expect(mocks.db.matchParseResult.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matchDayId: "m1",
        status: "FAILED",
        errorMessage: "DeepSeek 响应等待超时，请稍后重试。"
      })
    });
  });

  it("does not write a failed child result when deletion wins during an AI failure", async () => {
    mocks.parseMatchWithAi.mockRejectedValue(
      new DeepSeekError({
        code: "AI_UNAVAILABLE",
        message: "DeepSeek 服务暂时不可用，请稍后重试。",
        status: 503,
        retryable: true
      })
    );
    mocks.db.matchDay.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(parseRequest(), { params: { id: "m1" } });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MATCH_DAY_DELETED_DURING_PARSE"
    });
    expect(mocks.db.matchParseResult.create).not.toHaveBeenCalled();
  });

  it("updates the parent before creating the successful child in one transaction", async () => {
    const operations: string[] = [];
    mocks.db.matchDay.updateMany.mockImplementation(async () => {
      operations.push("update-parent");
      return { count: 1 };
    });
    mocks.db.matchParseResult.create.mockImplementation(async () => {
      operations.push("create-child");
      return { id: "parse-1" };
    });

    const response = await POST(parseRequest(), { params: { id: "m1" } });

    expect(response.status).toBe(200);
    expect(operations).toEqual(["update-parent", "create-child"]);
    await expect(response.json()).resolves.toMatchObject({
      modelName: "deepseek-test",
      usedFallback: false
    });
  });
});
