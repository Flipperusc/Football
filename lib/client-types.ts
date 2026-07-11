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

    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string };
        message = parsed.message;
      } catch {
        message = text;
      }
    }

    throw new Error(message ?? `请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}
