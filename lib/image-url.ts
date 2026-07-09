const absoluteImagePattern = /^(?:https?:|data:image\/|blob:)/i;
const localUploadPrefix = "/uploads/";

export function normalizeImageUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const normalized = trimmed.replace(/\\/g, "/");
  if (absoluteImagePattern.test(normalized)) return normalized;

  const uploadsIndex = normalized.toLowerCase().indexOf("/uploads/");
  if (uploadsIndex >= 0) return normalized.slice(uploadsIndex);

  if (normalized.toLowerCase().startsWith("uploads/")) return `/${normalized}`;
  if (normalized.startsWith("/")) return normalized;
  return `/${normalized}`;
}

export function isAllowedStoredImageUrl(value: string) {
  return value.startsWith("/uploads/") || /^https?:\/\//i.test(value);
}

export function getDisplayImageUrl(value?: string | null) {
  const normalized = normalizeImageUrl(value);
  if (!normalized) return "";

  if (normalized.startsWith(localUploadPrefix)) {
    return `/api/uploads?path=${encodeURIComponent(normalized.slice(localUploadPrefix.length))}`;
  }

  return normalized;
}
