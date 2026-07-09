import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { adminRequiredResponse, hasAdminSession } from "@/lib/server/admin-session";
import { ensureUploadFolder } from "@/lib/server/upload-storage";

export const runtime = "nodejs";

const allowedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

export async function POST(request: Request) {
  if (!hasAdminSession()) return adminRequiredResponse();

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ message: "请选择球队风采图片" }, { status: 400 });
  }

  const extension = allowedTypes.get(file.type);
  if (!extension) {
    return NextResponse.json({ message: "仅支持 JPG、PNG、WEBP、GIF 图片" }, { status: 400 });
  }

  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ message: "球队风采图片不能超过 8MB" }, { status: 400 });
  }

  const uploadDir = await ensureUploadFolder("team-photos");

  const filename = `${Date.now()}-${randomUUID()}${extension}`;
  const filepath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  return NextResponse.json({ url: `/uploads/team-photos/${filename}` }, { status: 201 });
}
