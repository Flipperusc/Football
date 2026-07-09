import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSafeUploadFilePath, uploadContentTypes } from "@/lib/server/upload-storage";

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ message: "Image not found" }, { status: 404 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = getSafeUploadFilePath(searchParams.get("path"));
  if (!filePath) return notFound();

  const extension = path.extname(filePath).toLowerCase();
  const contentType = uploadContentTypes.get(extension);
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
