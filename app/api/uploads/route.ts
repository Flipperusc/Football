import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const uploadRoot = path.join(process.cwd(), "public", "uploads");
const allowedFolders = new Set(["players", "team-photos"]);
const contentTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

function notFound() {
  return NextResponse.json({ message: "Image not found" }, { status: 404 });
}

function getSafeUploadPath(value: string | null) {
  if (!value) return null;

  const segments = value.split("/").filter(Boolean);
  if (segments.length < 2 || !allowedFolders.has(segments[0])) return null;
  if (segments.some((segment) => segment.includes("..") || /[\\]/.test(segment))) return null;

  const filePath = path.join(uploadRoot, ...segments);
  const relativePath = path.relative(uploadRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;

  return filePath;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = getSafeUploadPath(searchParams.get("path"));
  if (!filePath) return notFound();

  const extension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes.get(extension);
  if (!contentType) return notFound();

  try {
    const file = await readFile(filePath);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return notFound();
    throw error;
  }
}
