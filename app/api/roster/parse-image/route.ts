import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { parseRosterImageWithAi } from "@/lib/ai/roster";
import { prisma } from "@/lib/prisma";
import { apiErrorResponse } from "@/lib/server/api-error";

export const runtime = "nodejs";

const MAX_ROSTER_IMAGE_BYTES = 8 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function detectImageMime(bytes: Uint8Array) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

function badRequest(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("请上传分队图片");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("请选择分队图片");
  if (file.size === 0) return badRequest("分队图片不能为空");
  if (file.size > MAX_ROSTER_IMAGE_BYTES) {
    return badRequest("分队图片不能超过 8MB");
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = detectImageMime(bytes);
    if (!mimeType) {
      return badRequest("图片内容不是有效的 JPG、PNG、WEBP 或 GIF 格式");
    }

    const players = await prisma.player.findMany({
      include: { aliases: true },
      orderBy: { name: "asc" }
    });
    const imageDataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
    const result = await parseRosterImageWithAi({
      imageDataUrl,
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        aliases: player.aliases.map((alias) => ({
          alias: alias.alias,
          aliasType: alias.aliasType
        }))
      }))
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, "识别分队图片失败");
  }
}
