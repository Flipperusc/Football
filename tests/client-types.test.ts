import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "@/lib/client-types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("returns undefined for a successful DELETE response with no content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(
      requestJson<void>("/api/players/p1/aliases/a1", { method: "DELETE" })
    ).resolves.toBeUndefined();
  });
});
