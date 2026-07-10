"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Drawer, Empty, Form, Input, Modal, Segmented, Select, Skeleton, Tag } from "antd";
import {
  Activity, ArrowRight, CalendarCheck2, ChevronDown, ChevronUp, Handshake, Images,
  LockKeyhole, Medal, RefreshCw, Search, Shield, Sparkles, Target, TrendingUp, Trophy, UsersRound
} from "lucide-react";
import type { Player, PlayerStats, Season, TeamPhoto } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";
import { getDisplayImageUrl } from "@/lib/image-url";

type LoginValues = { username: string; password: string };
type TeamResultSummary = {
  teamColor: "RED" | "BLUE" | "WHITE";
  matchPoints: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  rank?: number | null;
};
type PublicMatchDaySummary = {
  id: string;
  date: string;
  type: "INTERNAL" | "EXTERNAL";
  confirmedAt?: string | null;
  goalCount: number;
  playerCount: number;
  teamResults: TeamResultSummary[];
};
type PublicOverview = {
  seasons: Season[];
  selectedSeasonId?: string;
  players: Player[];
  photos: TeamPhoto[];
  stats: PlayerStats[];
  matches: PublicMatchDaySummary[];
};
type RankingScope = "all" | "internal" | "external";
type RankingDefinition = {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
  rows: PlayerStats[];
  metricLabel: string;
  formatter?: (value: number) => string;
  valueGetter: (row: PlayerStats) => number;
};

const TEAM_NAME = "灵眸GPU";
const ROSTER_PREVIEW_COUNT = 12;
const avatarPalettes = [
  ["#155eef", "#53b1fd"], ["#004eeb", "#2e90fa"], ["#3538cd", "#8098f9"],
  ["#026aa2", "#36bffa"], ["#175cd3", "#84caff"], ["#194185", "#528bff"]
];
const teamLabels: Record<TeamResultSummary["teamColor"], string> = {
  BLUE: "蓝队", RED: "红队", WHITE: "白队"
};

function avatarStyle(name: string): CSSProperties {
  const hash = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const palette = avatarPalettes[hash % avatarPalettes.length];
  return { background: "linear-gradient(135deg, " + palette[0] + ", " + palette[1] + ")" };
}
function avatarLabel(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "球员";
  const words = trimmed.split(/\s+/);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return Array.from(trimmed).slice(0, 2).join("");
}
function formatRate(value?: number) {
  return (value ?? 0).toFixed(2);
}
function formatMatchDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}
function PlayerAvatar({ player, className, showJersey }: { player: Player; className: string; showJersey?: boolean }) {
  const avatarSrc = getDisplayImageUrl(player.avatarUrl);
  return (
    <span className={className} style={avatarStyle(player.name)}>
      {avatarSrc ? <img src={avatarSrc} alt={player.name} loading="lazy" /> : avatarLabel(player.name)}
      {showJersey && player.jerseyNumber ? <small className="public-jersey">#{player.jerseyNumber}</small> : null}
    </span>
  );
}
function safeAverage(total: number, appearances: number) {
  return appearances > 0 ? total / appearances : 0;
}
function rankBy(rows: PlayerStats[], valueGetter: (row: PlayerStats) => number) {
  return [...rows].filter((row) => valueGetter(row) > 0).sort((a, b) => {
    const valueDiff = valueGetter(b) - valueGetter(a);
    if (valueDiff !== 0) return valueDiff;
    const appearanceDiff = b.totalAppearances - a.totalAppearances;
    if (appearanceDiff !== 0) return appearanceDiff;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function RankingBoard({
  definition, expanded, onToggleExpanded, onOpenPlayer
}: {
  definition: RankingDefinition;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpenPlayer: (playerId: string) => void;
}) {
  const formatter = definition.formatter ?? String;
  const podium = definition.rows.slice(0, 3);
  const remainingRows = expanded ? definition.rows.slice(3) : definition.rows.slice(3, 10);
  if (!definition.rows.length) {
    return <section className="public-ranking-board public-ranking-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本赛季暂无该项数据" /></section>;
  }
  return (
    <section className="public-ranking-board">
      <div className="public-podium" aria-label={definition.title + "前三名"}>
        {podium.map((row, index) => {
          const player: Player = { id: row.playerId, name: row.name, avatarUrl: row.avatarUrl, status: "ACTIVE" };
          return (
            <button className={"public-podium-card public-podium-rank-" + (index + 1)} key={row.playerId} type="button" onClick={() => onOpenPlayer(row.playerId)}>
              <span className="public-podium-medal">{index + 1}</span>
              <PlayerAvatar player={player} className="public-podium-avatar" />
              <strong>{row.name}</strong>
              <span className="public-podium-value">{formatter(definition.valueGetter(row))}<small>{definition.metricLabel}</small></span>
            </button>
          );
        })}
      </div>
      {remainingRows.length ? (
        <div className="public-ranking-list">
          {remainingRows.map((row, index) => {
            const player: Player = { id: row.playerId, name: row.name, avatarUrl: row.avatarUrl, status: "ACTIVE" };
            return (
              <button className="public-ranking-row" key={row.playerId} type="button" onClick={() => onOpenPlayer(row.playerId)}>
                <span className="public-rank-index">{index + 4}</span>
                <PlayerAvatar player={player} className="public-mini-avatar" />
                <span className="public-rank-name">{row.name}</span>
                <span className="public-rank-value">{formatter(definition.valueGetter(row))}<small>{definition.metricLabel}</small></span>
              </button>
            );
          })}
        </div>
      ) : null}
      {definition.rows.length > 10 ? (
        <Button type="text" className="public-ranking-more" icon={expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />} onClick={onToggleExpanded} aria-expanded={expanded}>
          {expanded ? "收起榜单" : "查看全部 " + definition.rows.length + " 人"}
        </Button>
      ) : null}
    </section>
  );
}

function TeamGallery({ photos }: { photos: TeamPhoto[] }) {
  const [previewPhoto, setPreviewPhoto] = useState<TeamPhoto>();
  const visiblePhotos = photos.slice(0, 7);
  return (
    <>
      {photos.length ? (
        <div className="public-gallery-grid">
          {visiblePhotos.map((photo, index) => (
            <button className={"public-gallery-item " + (index === 0 ? "public-gallery-featured" : "")} key={photo.id} type="button" onClick={() => setPreviewPhoto(photo)}>
              <img src={getDisplayImageUrl(photo.imageUrl)} alt={photo.caption ?? "球队风采 " + (index + 1)} loading={index === 0 ? "eager" : "lazy"} />
              <span className="public-gallery-shade" />
              {photo.caption ? <strong>{photo.caption}</strong> : null}
              {index === visiblePhotos.length - 1 && photos.length > visiblePhotos.length ? <span className="public-gallery-more">+{photos.length - visiblePhotos.length}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="public-gallery-empty"><Images size={34} /><strong>球队精彩瞬间正在整理</strong><span>比赛、训练和聚会照片会展示在这里</span></div>
      )}
      <Modal open={Boolean(previewPhoto)} footer={null} centered width={860} className="public-photo-modal" onCancel={() => setPreviewPhoto(undefined)} title={previewPhoto?.caption ?? "球队风采"}>
        {previewPhoto ? <img className="public-photo-preview" src={getDisplayImageUrl(previewPhoto.imageUrl)} alt={previewPhoto.caption ?? "球队风采"} /> : null}
      </Modal>
    </>
  );
}
export default function PublicTeamPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [overview, setOverview] = useState<PublicOverview>();
  const [seasonId, setSeasonId] = useState<string>();
  const [rankingScope, setRankingScope] = useState<RankingScope>("all");
  const [activeRankingKey, setActiveRankingKey] = useState("all-goals");
  const [rankingExpanded, setRankingExpanded] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [rosterMode, setRosterMode] = useState<"active" | "all">("active");
  const [rosterExpanded, setRosterExpanded] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player>();
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load(nextSeasonId?: string, initial = false) {
    setLoading(true);
    try {
      setLoadError(undefined);
      const querySeasonId =
        nextSeasonId ??
        (initial && typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("season") ?? undefined
          : seasonId);
      const query = querySeasonId ? "?seasonId=" + encodeURIComponent(querySeasonId) : "";
      const data = await requestJson<PublicOverview>("/api/public/overview" + query);
      setOverview(data);
      setSeasonId(data.selectedSeasonId);
      if (initial && typeof window !== "undefined") {
        const playerId = new URLSearchParams(window.location.search).get("player");
        if (playerId) setSelectedPlayer(data.players.find((player) => player.id === playerId));
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载球队数据失败");
    } finally {
      setLoading(false);
    }
  }

  async function login(values: LoginValues) {
    setLoginLoading(true);
    try {
      await requestJson<{ ok: boolean }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      message.success("登录成功");
      setLoginOpen(false);
      router.push("/admin");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginLoading(false);
    }
  }

  useEffect(() => {
    void load(undefined, true);
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("admin") === "login_required"
    ) setLoginOpen(true);
  }, []);

  const seasons = overview?.seasons ?? [];
  const players = overview?.players ?? [];
  const stats = overview?.stats ?? [];
  const matchDays = overview?.matches ?? [];
  const teamPhotos = overview?.photos ?? [];
  const currentSeason = seasons.find((season) => season.id === seasonId);
  const latestMatch = matchDays[0];

  const statsByPlayerId = useMemo(
    () => new Map(stats.map((item) => [item.playerId, item])),
    [stats]
  );

  const allPlayerCards = useMemo(
    () =>
      players
        .map((player) => ({ player, stats: statsByPlayerId.get(player.id) }))
        .sort((a, b) => {
          if (a.player.status !== b.player.status) return a.player.status === "ACTIVE" ? -1 : 1;
          const scoreA = (a.stats?.internalSeasonPoints ?? 0) + (a.stats?.totalGoals ?? 0);
          const scoreB = (b.stats?.internalSeasonPoints ?? 0) + (b.stats?.totalGoals ?? 0);
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.player.name.localeCompare(b.player.name, "zh-CN");
        }),
    [players, statsByPlayerId]
  );

  const positions = useMemo(
    () =>
      Array.from(
        new Set(players.map((player) => player.position?.trim()).filter(Boolean) as string[])
      ).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [players]
  );

  const filteredPlayerCards = useMemo(() => {
    const keyword = playerSearch.trim().toLocaleLowerCase("zh-CN");
    return allPlayerCards.filter(({ player }) => {
      if (rosterMode === "active" && player.status !== "ACTIVE") return false;
      if (positionFilter !== "all" && player.position !== positionFilter) return false;
      if (!keyword) return true;
      return [player.name, player.position, player.jerseyNumber?.toString()]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(keyword));
    });
  }, [allPlayerCards, playerSearch, positionFilter, rosterMode]);

  const visiblePlayerCards =
    rosterExpanded || playerSearch.trim() || positionFilter !== "all"
      ? filteredPlayerCards
      : filteredPlayerCards.slice(0, ROSTER_PREVIEW_COUNT);

  const rankingDefinitions = useMemo<RankingDefinition[]>(() => {
    const make = (
      key: string,
      title: string,
      description: string,
      icon: ReactNode,
      valueGetter: (row: PlayerStats) => number,
      metricLabel: string,
      formatter?: (value: number) => string
    ): RankingDefinition => ({
      key,
      title,
      description,
      icon,
      rows: rankBy(stats, valueGetter),
      valueGetter,
      metricLabel,
      formatter
    });

    if (rankingScope === "all") {
      return [
        make("all-goals", "总射手榜", "队内赛与队外赛进球总和", <Target size={18} />, (row) => row.totalGoals, "球"),
        make("all-assists", "总助攻榜", "队内赛与队外赛助攻总和", <Handshake size={18} />, (row) => row.totalAssists, "助"),
        make("all-appearances", "总出勤榜", "全部已确认比赛出勤次数", <Activity size={18} />, (row) => row.totalAppearances, "场"),
        make("all-goals-rate", "场均进球", "总进球除以总出勤", <TrendingUp size={18} />, (row) => row.goalsPerAppearance, "球/场", formatRate)
      ];
    }
    if (rankingScope === "external") {
      return [
        make("external-goals", "队外射手榜", "队外赛进球统计", <Target size={18} />, (row) => row.externalGoals, "球"),
        make("external-assists", "队外助攻榜", "队外赛助攻统计", <Handshake size={18} />, (row) => row.externalAssists, "助"),
        make("external-appearances", "队外出勤榜", "队外赛出勤次数", <Activity size={18} />, (row) => row.externalAppearances, "场")
      ];
    }
    return [
      make("internal-points", "队内积分榜", "按队内赛名次获得的个人赛季积分", <Medal size={18} />, (row) => row.internalSeasonPoints, "分"),
      make("internal-goals", "队内射手榜", "队内赛进球统计", <Target size={18} />, (row) => row.internalGoals, "球"),
      make("internal-assists", "队内助攻榜", "队内赛助攻统计", <Handshake size={18} />, (row) => row.internalAssists, "助"),
      make("internal-appearances", "队内出勤榜", "队内赛阵容出勤次数", <Activity size={18} />, (row) => row.internalAppearances, "场"),
      make("best-defenders", "最佳后卫榜", "获得最佳后卫奖项次数", <Shield size={18} />, (row) => row.bestDefenderAwards, "次"),
      make("internal-points-rate", "场均积分", "队内积分除以队内出勤", <TrendingUp size={18} />, (row) => safeAverage(row.internalSeasonPoints, row.internalAppearances), "分/场", formatRate),
      make("internal-goals-rate", "队内场均进球", "队内进球除以队内出勤", <Trophy size={18} />, (row) => safeAverage(row.internalGoals, row.internalAppearances), "球/场", formatRate)
    ];
  }, [rankingScope, stats]);

  const activeRanking =
    rankingDefinitions.find((definition) => definition.key === activeRankingKey) ??
    rankingDefinitions[0];

  const summary = useMemo(
    () => ({
      players: players.filter((player) => player.status === "ACTIVE").length,
      confirmedMatchDays: matchDays.length,
      goals: stats.reduce((sum, item) => sum + item.totalGoals, 0),
      assists: stats.reduce((sum, item) => sum + item.totalAssists, 0)
    }),
    [matchDays, players, stats]
  );

  const heroStyle = teamPhotos[0]
    ? ({
        "--public-hero-image":
          "url(" + JSON.stringify(getDisplayImageUrl(teamPhotos[0].imageUrl)) + ")"
      } as CSSProperties)
    : undefined;

  function syncUrl(nextSeasonId?: string, playerId?: string) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextSeasonId) url.searchParams.set("season", nextSeasonId);
    else url.searchParams.delete("season");
    if (playerId) url.searchParams.set("player", playerId);
    else url.searchParams.delete("player");
    url.searchParams.delete("admin");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function openPlayer(playerId: string) {
    const player = players.find((item) => item.id === playerId);
    if (!player) return;
    setSelectedPlayer(player);
    syncUrl(seasonId, player.id);
  }

  function closePlayer() {
    setSelectedPlayer(undefined);
    syncUrl(seasonId);
  }

  function changeRankingScope(value: string | number) {
    const nextScope = value as RankingScope;
    setRankingScope(nextScope);
    setActiveRankingKey(
      nextScope === "all" ? "all-goals" : nextScope === "internal" ? "internal-points" : "external-goals"
    );
    setRankingExpanded(false);
  }

  const selectedStats = selectedPlayer ? statsByPlayerId.get(selectedPlayer.id) : undefined;
  return (
    <main className="public-page" id="top">
      <header className="public-topbar">
        <a className="public-brand" href="#top" aria-label={TEAM_NAME + " 首页"}>
          <span className="public-brand-mark"><Trophy size={20} /></span>
          <span><strong>{TEAM_NAME}</strong><small>FOOTBALL CLUB</small></span>
        </a>
        <nav className="public-nav" aria-label="前台导航">
          <a href="#rankings">榜单</a>
          <a href="#gallery">风采</a>
          <a href="#players">球员</a>
          <Button type="text" className="public-admin-button" icon={<Shield size={15} />} onClick={() => setLoginOpen(true)}>后台</Button>
        </nav>
      </header>

      <section className="public-hero" style={heroStyle}>
        <div className="public-hero-copy">
          <span className="public-season-badge"><Sparkles size={14} />{currentSeason?.name ?? "球队数据中心"}</span>
          <h1>让每一次上场<br />都有记录</h1>
          <p>查看灵眸GPU的赛季积分、进球、助攻与出勤表现，见证球队每一场成长。</p>
          <div className="public-hero-actions">
            <a className="public-primary-link" href="#rankings">查看赛季榜单 <ArrowRight size={16} /></a>
            <a className="public-secondary-link" href="#players">寻找球员</a>
          </div>
        </div>

        <aside className="public-latest-card">
          <div className="public-latest-header">
            <span>最近比赛</span>
            <Select
              className="public-season-select"
              value={seasonId}
              options={seasons.map((season) => ({ label: season.name, value: season.id }))}
              onChange={(value) => {
                setSeasonId(value);
                syncUrl(value, selectedPlayer?.id);
                void load(value);
              }}
              placeholder="选择赛季"
              aria-label="选择赛季"
            />
          </div>
          {latestMatch ? (
            <>
              <div className="public-latest-meta">
                <CalendarCheck2 size={18} />
                <div>
                  <strong>{formatMatchDate(latestMatch.date)}</strong>
                  <span>{latestMatch.type === "INTERNAL" ? "队内赛" : "队外赛"}</span>
                </div>
              </div>
              {latestMatch.type === "INTERNAL" && latestMatch.teamResults.length ? (
                <div className="public-team-results">
                  {[...latestMatch.teamResults]
                    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                    .map((result) => (
                      <div className={"public-team-result public-team-" + result.teamColor.toLowerCase()} key={result.teamColor}>
                        <span>{result.rank ? "第" + result.rank + "名" : "完成"}</span>
                        <strong>{teamLabels[result.teamColor]}</strong>
                        <b>{result.matchPoints} 分</b>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="public-external-summary">
                  <strong>{latestMatch.goalCount}</strong>
                  <span>粒进球 · {latestMatch.playerCount} 人出勤</span>
                </div>
              )}
              {latestMatch.type === "INTERNAL" ? (
                <Link className="public-match-link" href={"/matchdays/" + latestMatch.id + "/share"}>
                  查看赛后战报 <ArrowRight size={15} />
                </Link>
              ) : null}
            </>
          ) : (
            <div className="public-latest-empty"><CalendarCheck2 size={24} /><span>本赛季还没有已确认比赛</span></div>
          )}
        </aside>
      </section>

      {loadError ? (
        <div className="public-alert">
          <span>{loadError}</span>
          <Button type="link" icon={<RefreshCw size={15} />} onClick={() => load(seasonId)}>重新加载</Button>
        </div>
      ) : null}

      {loading && !overview ? (
        <div className="public-loading-shell"><Skeleton active paragraph={{ rows: 8 }} /></div>
      ) : (
        <>
          <section className="public-summary-grid" aria-label="赛季概览">
            <div className="public-summary-card"><span className="public-summary-icon"><UsersRound size={20} /></span><div><span>活跃球员</span><strong>{summary.players}</strong></div></div>
            <div className="public-summary-card"><span className="public-summary-icon"><CalendarCheck2 size={20} /></span><div><span>已确认比赛</span><strong>{summary.confirmedMatchDays}</strong></div></div>
            <div className="public-summary-card"><span className="public-summary-icon"><Target size={20} /></span><div><span>赛季总进球</span><strong>{summary.goals}</strong></div></div>
            <div className="public-summary-card"><span className="public-summary-icon"><Handshake size={20} /></span><div><span>赛季总助攻</span><strong>{summary.assists}</strong></div></div>
          </section>

          {seasons.length === 0 ? (
            <section className="public-section public-empty-section"><Empty description="还没有可展示的赛季数据" /></section>
          ) : (
            <>
              <section className="public-section" id="rankings">
                <div className="public-section-heading">
                  <div>
                    <span className="public-eyebrow">SEASON LEADERS</span>
                    <h2>赛季榜单</h2>
                    <p>切换数据范围和榜单类型，快速查看本赛季领先球员。</p>
                  </div>
                  <Segmented
                    value={rankingScope}
                    options={[
                      { label: "总数据", value: "all" },
                      { label: "队内赛", value: "internal" },
                      { label: "队外赛", value: "external" }
                    ]}
                    onChange={changeRankingScope}
                  />
                </div>

                <div className="public-ranking-shell">
                  <div className="public-ranking-tabs" role="tablist" aria-label="选择榜单">
                    {rankingDefinitions.map((definition) => (
                      <button
                        key={definition.key}
                        type="button"
                        role="tab"
                        aria-selected={definition.key === activeRanking.key}
                        className={definition.key === activeRanking.key ? "is-active" : ""}
                        onClick={() => {
                          setActiveRankingKey(definition.key);
                          setRankingExpanded(false);
                        }}
                      >
                        {definition.icon}<span>{definition.title}</span>
                      </button>
                    ))}
                  </div>
                  <div className="public-active-ranking-title">
                    <div><h3>{activeRanking.title}</h3><p>{activeRanking.description}</p></div>
                    <Tag color="blue">数据实时重算</Tag>
                  </div>
                  <RankingBoard
                    definition={activeRanking}
                    expanded={rankingExpanded}
                    onToggleExpanded={() => setRankingExpanded((value) => !value)}
                    onOpenPlayer={openPlayer}
                  />
                </div>
              </section>

              <section className="public-section" id="gallery">
                <div className="public-section-heading">
                  <div><span className="public-eyebrow">TEAM MOMENTS</span><h2>球队风采</h2><p>比赛、训练和聚会中的精彩瞬间。</p></div>
                  <span className="public-section-count">{teamPhotos.length} 张照片</span>
                </div>
                <TeamGallery photos={teamPhotos} />
              </section>

              <section className="public-section" id="players">
                <div className="public-section-heading public-roster-heading">
                  <div><span className="public-eyebrow">OUR SQUAD</span><h2>球员阵容</h2><p>搜索姓名、号码或位置，点击球员查看赛季表现。</p></div>
                  <span className="public-section-count">{filteredPlayerCards.length} 名球员</span>
                </div>
                <div className="public-roster-toolbar">
                  <Input prefix={<Search size={16} />} allowClear value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="搜索球员、号码或位置" aria-label="搜索球员" />
                  <Select
                    value={positionFilter}
                    onChange={setPositionFilter}
                    options={[{ label: "全部位置", value: "all" }, ...positions.map((position) => ({ label: position, value: position }))]}
                    aria-label="按位置筛选球员"
                  />
                  <Segmented value={rosterMode} options={[{ label: "活跃", value: "active" }, { label: "全部", value: "all" }]} onChange={(value) => setRosterMode(value as "active" | "all")} />
                </div>

                {visiblePlayerCards.length ? (
                  <div className="public-roster-grid">
                    {visiblePlayerCards.map(({ player, stats: playerStats }) => (
                      <button className="public-player-card" key={player.id} type="button" onClick={() => openPlayer(player.id)}>
                        <PlayerAvatar player={player} className="public-avatar" showJersey />
                        <strong>{player.name}</strong>
                        <span>{player.position ?? "球员"}</span>
                        <div className="public-player-metrics">
                          <span><b>{playerStats?.internalSeasonPoints ?? 0}</b>积分</span>
                          <span><b>{playerStats?.totalGoals ?? 0}</b>进球</span>
                          <span><b>{playerStats?.totalAssists ?? 0}</b>助攻</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="public-roster-empty"><Empty description="没有找到符合条件的球员" /></div>
                )}

                {!playerSearch.trim() && positionFilter === "all" && filteredPlayerCards.length > ROSTER_PREVIEW_COUNT ? (
                  <Button className="public-roster-more" icon={rosterExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />} onClick={() => setRosterExpanded((value) => !value)}>
                    {rosterExpanded ? "收起阵容" : "查看全部 " + filteredPlayerCards.length + " 名球员"}
                  </Button>
                ) : null}
              </section>
            </>
          )}
        </>
      )}

      <footer className="public-footer">
        <div className="public-brand public-footer-brand"><span className="public-brand-mark"><Trophy size={18} /></span><span><strong>{TEAM_NAME}</strong><small>FOOTBALL CLUB</small></span></div>
        <p>所有榜单均根据已确认比赛事件实时计算。</p>
        <Button type="text" icon={<RefreshCw size={14} />} onClick={() => load(seasonId)} loading={loading}>刷新数据</Button>
      </footer>

      <Drawer
        width="min(520px, 100vw)"
        open={Boolean(selectedPlayer)}
        onClose={closePlayer}
        title={selectedPlayer ? (
          <div className="public-drawer-title">
            <PlayerAvatar player={selectedPlayer} className="public-mini-avatar" />
            <div><strong>{selectedPlayer.name}</strong><span>{currentSeason?.name}</span></div>
          </div>
        ) : null}
      >
        {selectedPlayer ? (
          <>
            <div className="public-player-profile">
              <Tag color={selectedPlayer.status === "ACTIVE" ? "blue" : "default"}>{selectedPlayer.status === "ACTIVE" ? "活跃" : "停用"}</Tag>
              <span>{selectedPlayer.position ?? "未设置位置"}</span>
              <span>{selectedPlayer.jerseyNumber ? "#" + selectedPlayer.jerseyNumber : "暂无号码"}</span>
            </div>
            <div className="public-player-hero-stats">
              <div><span>总进球</span><strong>{selectedStats?.totalGoals ?? 0}</strong></div>
              <div><span>总助攻</span><strong>{selectedStats?.totalAssists ?? 0}</strong></div>
              <div><span>总出勤</span><strong>{selectedStats?.totalAppearances ?? 0}</strong></div>
            </div>
            <h3 className="public-detail-title">队内赛</h3>
            <div className="public-detail-grid">
              <div><span>赛季积分</span><strong>{selectedStats?.internalSeasonPoints ?? 0}</strong></div>
              <div><span>场均积分</span><strong>{formatRate(selectedStats?.pointsPerInternalAppearance)}</strong></div>
              <div><span>进球</span><strong>{selectedStats?.internalGoals ?? 0}</strong></div>
              <div><span>助攻</span><strong>{selectedStats?.internalAssists ?? 0}</strong></div>
              <div><span>出勤</span><strong>{selectedStats?.internalAppearances ?? 0}</strong></div>
              <div><span>最佳后卫</span><strong>{selectedStats?.bestDefenderAwards ?? 0}</strong></div>
            </div>
            <h3 className="public-detail-title">队外赛</h3>
            <div className="public-detail-grid">
              <div><span>进球</span><strong>{selectedStats?.externalGoals ?? 0}</strong></div>
              <div><span>助攻</span><strong>{selectedStats?.externalAssists ?? 0}</strong></div>
              <div><span>出勤</span><strong>{selectedStats?.externalAppearances ?? 0}</strong></div>
              <div><span>总场均进球</span><strong>{formatRate(selectedStats?.goalsPerAppearance)}</strong></div>
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal title="管理员登录" open={loginOpen} footer={null} onCancel={() => setLoginOpen(false)} destroyOnClose>
        <Form<LoginValues> layout="vertical" onFinish={login}>
          <Form.Item name="username" label="管理员账号" rules={[{ required: true, message: "请输入管理员账号" }]}><Input autoComplete="username" /></Form.Item>
          <Form.Item name="password" label="管理员密码" rules={[{ required: true, message: "请输入管理员密码" }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Button block type="primary" htmlType="submit" icon={<LockKeyhole size={16} />} loading={loginLoading}>进入后台</Button>
        </Form>
      </Modal>
    </main>
  );
}
