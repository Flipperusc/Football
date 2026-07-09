import { mkdir } from "fs/promises";
import path from "path";

export const allowedUploadFolders = new Set(["players", "team-photos"]);

export const uploadContentTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

export function getUploadRoot() {
  const configuredRoot = process.env.UPLOAD_DIR?.trim();
  return configuredRoot
    ? path.resolve(configuredRoot)
    : path.join(process.cwd(), "public", "uploads");
}

export async function ensureUploadFolder(folder: string) {
  if (!allowedUploadFolders.has(folder)) throw new Error("Invalid upload folder");

  const uploadDir = path.join(getUploadRoot(), folder);
  await mkdir(uploadDir, { recursive: true });
  return uploadDir;
}

export function getSafeUploadFilePath(value: string | null) {
  if (!value) return null;

  const segments = value.split("/").filter(Boolean);
  if (segments.length < 2 || !allowedUploadFolders.has(segments[0])) return null;
  if (segments.some((segment) => segment.includes("..") || /[\\]/.test(segment))) return null;

  const uploadRoot = getUploadRoot();
  const filePath = path.join(uploadRoot, ...segments);
  const relativePath = path.relative(uploadRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;

  return filePath;
}
