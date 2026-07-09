import { describe, expect, it } from "vitest";
import { getDisplayImageUrl, normalizeImageUrl } from "@/lib/image-url";

describe("image URL helpers", () => {
  it("normalizes uploaded image paths for storage", () => {
    expect(normalizeImageUrl("uploads/players/avatar.png")).toBe("/uploads/players/avatar.png");
    expect(normalizeImageUrl("https://example.com/uploads/team-photos/a.jpg")).toBe(
      "https://example.com/uploads/team-photos/a.jpg"
    );
  });

  it("routes local uploads through the image API for display", () => {
    expect(getDisplayImageUrl("/uploads/players/avatar.png")).toBe(
      "/api/uploads?path=players%2Favatar.png"
    );
    expect(getDisplayImageUrl("/uploads/team-photos/team photo.webp")).toBe(
      "/api/uploads?path=team-photos%2Fteam%20photo.webp"
    );
  });

  it("leaves remote image URLs unchanged for display", () => {
    expect(getDisplayImageUrl("https://example.com/avatar.png")).toBe(
      "https://example.com/avatar.png"
    );
  });
});
