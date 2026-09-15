import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPlayers: vi.fn(),
  parseRosterImageWithAi: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { player: { findMany: mocks.findPlayers } }
}));
vi.mock("@/lib/ai/roster", () => ({
  parseRosterImageWithAi: mocks.parseRosterImageWithAi
}));

import { POST } from "@/app/api/roster/parse-image/route";

function imageRequest(bytes: Uint8Array, type = "image/png", name = "roster.png") {
  const formData = new FormData();
  formData.append("file", new File([bytes], name, { type }));
  return new Request("http://localhost/api/roster/parse-image", {
    method: "POST",
    body: formData
  });
}

describe("roster image OCR route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPlayers.mockResolvedValue([
      {
        id: "p1",
        name: "果之林",
        aliases: [{ alias: "林哥", aliasType: "MANUAL" }]
      }
    ]);
    mocks.parseRosterImageWithAi.mockResolvedValue({
      parsed: { assignments: [], uncertainItems: [] },
      ocrText: "红\n果之林",
      modelName: "deepseek-flash",
      usedFallback: false
    });
  });

  it("sends a validated image data URL and known players to OCR", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

    const response = await POST(imageRequest(pngBytes));

    expect(response.status).toBe(200);
    expect(mocks.parseRosterImageWithAi).toHaveBeenCalledWith({
      imageDataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`,
      players: [
        {
          id: "p1",
          name: "果之林",
          aliases: [{ alias: "林哥", aliasType: "MANUAL" }]
        }
      ]
    });
    await expect(response.json()).resolves.toMatchObject({
      ocrText: "红\n果之林",
      modelName: "deepseek-flash",
      usedFallback: false
    });
  });

  it("rejects a file whose bytes are not a supported image before querying players", async () => {
    const response = await POST(imageRequest(new Uint8Array([1, 2, 3, 4])));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "图片内容不是有效的 JPG、PNG、WEBP 或 GIF 格式"
    });
    expect(mocks.findPlayers).not.toHaveBeenCalled();
    expect(mocks.parseRosterImageWithAi).not.toHaveBeenCalled();
  });

  it("rejects images larger than 8MB before reading players or calling OCR", async () => {
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1);

    const response = await POST(imageRequest(oversized));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "分队图片不能超过 8MB"
    });
    expect(mocks.findPlayers).not.toHaveBeenCalled();
    expect(mocks.parseRosterImageWithAi).not.toHaveBeenCalled();
  });
});
