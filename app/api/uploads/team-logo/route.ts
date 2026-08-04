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
  ["image/webp", ".webp"]
]);

export async function POST(request: Request) {
  if (!hasAdminSession()) return adminRequiredResponse();

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ message: "请选择球队 Logo 图片" }, { status: 400 });
  }

  const extension = allowedTypes.get(file.type);
  if (!extension) {
    return NextResponse.json({ message: "仅支持 JPG、PNG、WEBP 图片" }, { status: 400 });
  }

  if (file.size > 4 * 1024 * 1024) {
    return NextResponse.json({ message: "球队 Logo 不能超过 4MB" }, { status: 400 });
  }

  const uploadDir = await ensureUploadFolder("team-brand");
  const filename = Date.now() + "-" + randomUUID() + extension;
  const filepath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  return NextResponse.json({ url: "/uploads/team-brand/" + filename }, { status: 201 });
}
