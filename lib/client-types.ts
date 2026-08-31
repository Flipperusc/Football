export type Player = {
  id: string;
  name: string;
  jerseyNumber?: number | null;
  position?: string | null;
  avatarUrl?: string | null;
  status: "ACTIVE" | "INACTIVE";
  aliases?: { id: string; alias: string; aliasType: string }[];
};

export type Season = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "ACTIVE" | "ENDED";
};

export type MatchDay = {
  id: string;
  seasonId: string;
  date: string;
  type: "INTERNAL" | "EXTERNAL";
  rawText?: string | null;
  parseStatus: "PENDING" | "PARSED" | "CONFIRMED" | "FAILED";
  season?: Season;
  assignments?: {
    id: string;
    teamColor: "RED" | "BLUE" | "WHITE" | "EXTERNAL";
    playerId: string;
    role: "PLAYER" | "GOALKEEPER";
    isCaptain: boolean;
    player?: Player;
  }[];
  parseResults?: {
    id: string;
    parsedJson: unknown;
    status: string;
    modelName: string;
    createdAt: string;
  }[];
};

export type PlayerStats = {
  playerId: string;
  name: string;
  position?: string | null;
  avatarUrl?: string | null;
  internalGoals: number;
  internalAssists: number;
  internalAppearances: number;
  internalSeasonPoints: number;
  bestDefenderAwards: number;
  externalGoals: number;
  externalAssists: number;
  externalAppearances: number;
  totalGoals: number;
  totalAssists: number;
  totalAppearances: number;
  goalsPerAppearance: number;
  assistsPerAppearance: number;
  pointsPerInternalAppearance: number;
};

export type PlayerStatAdjustment = {
  id: string;
  playerId: string;
  seasonId: string;
  metric:
    | "INTERNAL_GOALS"
    | "INTERNAL_ASSISTS"
    | "INTERNAL_APPEARANCES"
    | "INTERNAL_SEASON_POINTS"
    | "EXTERNAL_GOALS"
    | "EXTERNAL_ASSISTS"
    | "EXTERNAL_APPEARANCES";
  operation: "SET" | "ADJUST";
  value: number;
  reason: string;
  createdAt: string;
  season?: Season;
};

export type TeamPhoto = {
  id: string;
  imageUrl: string;
  caption?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeamSetting = {
  logoUrl?: string | null;
};

export const AI_AVAILABILITY_EVENT = "football:ai-availability";

export type AiAvailabilityEventDetail = {
  available: boolean;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function reportAiAvailability(available: boolean) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<AiAvailabilityEventDetail>(AI_AVAILABILITY_EVENT, {
      detail: { available }
    })
  );
}

export function getRequestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function defaultHttpErrorMessage(status: number, url: string) {
  if (status === 504) {
    return url.includes("/api/matchdays/") && url.endsWith("/parse")
      ? "服务器等待 DeepSeek 响应超时。比赛信息已经保存，请点击“重新解析”再次尝试。"
      : "服务器等待 DeepSeek 响应超时，请稍后重试。";
  }
  if (status === 502) return "上游服务响应异常，请稍后重试。";
  if (status === 503) return "服务暂时不可用，请稍后重试。";
  return `请求失败：${status}`;
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message: string | undefined;
    let code: string | undefined;

    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: string };
        message = parsed.message;
        code = parsed.code;
      } catch {
        const looksLikeHtml = /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(text);
        if (!looksLikeHtml && text.length <= 300) message = text;
      }
    }

    throw new ApiRequestError(
      message ?? defaultHttpErrorMessage(response.status, url),
      response.status,
      code
    );
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json()) as T;

  if (
    data &&
    typeof data === "object" &&
    "usedFallback" in data &&
    typeof data.usedFallback === "boolean"
  ) {
    reportAiAvailability(!data.usedFallback);
  }

  return data;
}
