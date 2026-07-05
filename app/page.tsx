"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Tag
} from "antd";
import {
  Activity,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Handshake,
  Images,
  LockKeyhole,
  Medal,
  RefreshCw,
  Shield,
  Target,
  TrendingUp,
  Trophy,
  UserRound
} from "lucide-react";
import type { MatchDay, Player, PlayerStats, RecentStatChange, Season, TeamPhoto } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

type LoginValues = {
  username: string;
  password: string;
};

type PlayerCardData = {
  player: Player;
  stats?: PlayerStats;
};

type PlayerDetail = {
  stats?: PlayerStats;
  recentChanges: RecentStatChange[];
};

type RankingScope = "internal" | "external";

type RankingDefinition = {
  key: string;
  title: string;
  icon: ReactNode;
  rows: PlayerStats[];
  metricLabel: string;
  formatter?: (value: number) => string;
  valueGetter: (row: PlayerStats) => number;
};

const TEAM_NAME = "灵眸GPU";
const PREVIEW_RANKING_COUNT = 6;

const avatarPalettes = [
  ["#0f766e", "#22c55e"],
  ["#2563eb", "#06b6d4"],
  ["#b45309", "#f59e0b"],
  ["#be123c", "#fb7185"],
  ["#4338ca", "#60a5fa"],
  ["#15803d", "#84cc16"]
];

function hashText(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function avatarStyle(name: string): CSSProperties {
  const palette = avatarPalettes[hashText(name) % avatarPalettes.length];
  return {
    background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`
  };
}

function avatarLabel(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "球员";
  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  return Array.from(trimmed).slice(0, 2).join("");
}

function formatRate(value?: number) {
  return (value ?? 0).toFixed(2);
}

function PlayerAvatar({
  player,
  className,
  showJersey
}: {
  player: Player;
  className: string;
  showJersey?: boolean;
}) {
  return (
    <span className={className} style={avatarStyle(player.name)}>
      {player.avatarUrl ? (
        <img src={player.avatarUrl} alt={player.name} />
      ) : (
        avatarLabel(player.name)
      )}
      {showJersey && player.jerseyNumber ? (
        <small className="public-jersey">#{player.jerseyNumber}</small>
      ) : null}
    </span>
  );
}

function safeAverage(total: number, appearances: number) {
  return appearances > 0 ? total / appearances : 0;
}

function rankBy(rows: PlayerStats[], valueGetter: (row: PlayerStats) => number) {
  return [...rows].sort((a, b) => {
    const valueDiff = valueGetter(b) - valueGetter(a);
    if (valueDiff !== 0) return valueDiff;
    const appearanceDiff = b.totalAppearances - a.totalAppearances;
    if (appearanceDiff !== 0) return appearanceDiff;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function RankingBoard({
  title,
  icon,
  rows,
  metricLabel,
  formatter = String,
  valueGetter,
  expanded,
  onToggleExpanded
}: {
  title: string;
  icon: ReactNode;
  rows: PlayerStats[];
  metricLabel: string;
  formatter?: (value: number) => string;
  valueGetter: (row: PlayerStats) => number;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const visibleRows = expanded ? rows : rows.slice(0, PREVIEW_RANKING_COUNT);
  const canExpand = rows.length > PREVIEW_RANKING_COUNT;

  return (
    <section className="public-ranking-board">
      <div className="public-board-header">
        <div className="public-board-title">
          <span>{icon}</span>
          <h3>{title}</h3>
        </div>
        {canExpand ? (
          <Button
            type="text"
            size="small"
            icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            onClick={onToggleExpanded}
          >
            {expanded ? "收起" : "展开全部"}
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无榜单数据" />
      ) : (
        <div className="public-ranking-list">
          {visibleRows.map((row, index) => (
            <div className="public-ranking-row" key={row.playerId}>
              <span className="public-rank-index">{index + 1}</span>
              <span className="public-mini-avatar" style={avatarStyle(row.name)}>
                {avatarLabel(row.name)}
              </span>
              <span className="public-rank-name">{row.name}</span>
              <span className="public-rank-value">
                {formatter(valueGetter(row))}
                <small>{metricLabel}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TeamStyleRail({ photos }: { photos: TeamPhoto[] }) {
  const [featured, ...restPhotos] = photos;
  const previewPhotos = restPhotos.slice(0, 4);

  return (
    <aside className="team-style-panel">
      <div className="team-style-header">
        <span>
          <Images size={18} />
        </span>
        <div>
          <h2>球队风采</h2>
          <p>比赛、训练和聚会瞬间</p>
        </div>
      </div>

      {featured ? (
        <>
          <figure className="team-style-featured">
            <img src={featured.imageUrl} alt={featured.caption ?? "球队风采"} />
            {featured.caption ? <figcaption>{featured.caption}</figcaption> : null}
          </figure>
          {previewPhotos.length ? (
            <div className="team-style-photo-grid">
              {previewPhotos.map((photo, index) => (
                <figure className="team-style-thumb-photo" key={photo.id}>
                  <img src={photo.imageUrl} alt={photo.caption ?? "球队风采"} />
                  {photo.caption ? <figcaption>{photo.caption}</figcaption> : null}
                  {index === previewPhotos.length - 1 && photos.length > 5 ? (
                    <span className="team-style-more">+{photos.length - 5}</span>
                  ) : null}
                </figure>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="team-style-empty">
          <Images size={34} />
          <span>管理员上传照片后会显示在这里</span>
        </div>
      )}
    </aside>
  );
}

export default function PublicTeamPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [players, setPlayers] = useState<Player[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchDays, setMatchDays] = useState<MatchDay[]>([]);
  const [teamPhotos, setTeamPhotos] = useState<TeamPhoto[]>([]);
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [seasonId, setSeasonId] = useState<string>();
  const [rankingScope, setRankingScope] = useState<RankingScope>("internal");
  const [expandedBoards, setExpandedBoards] = useState<Record<string, boolean>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<Player>();
  const [selectedPlayerDetail, setSelectedPlayerDetail] = useState<PlayerDetail>();
  const [selectedPlayerLoading, setSelectedPlayerLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load(nextSeasonId?: string) {
    setLoading(true);
    try {
      setLoadError(undefined);
      const [seasonRows, playerRows, matchRows, photoRows] = await Promise.all([
        requestJson<Season[]>("/api/seasons"),
        requestJson<Player[]>("/api/players"),
        requestJson<MatchDay[]>("/api/matchdays"),
        requestJson<TeamPhoto[]>("/api/team-photos")
      ]);
      setSeasons(seasonRows);
      setPlayers(playerRows);
      setMatchDays(matchRows);
      setTeamPhotos(photoRows);

      const active =
        nextSeasonId ??
        seasonId ??
        seasonRows.find((season) => season.status === "ACTIVE")?.id ??
        seasonRows[0]?.id;
      setSeasonId(active);

      if (active) {
        setStats(await requestJson<PlayerStats[]>(`/api/stats/season/${active}/players`));
      } else {
        setStats([]);
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
    void load();
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("admin") === "login_required"
    ) {
      setLoginOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!selectedPlayer || !seasonId) {
      setSelectedPlayerDetail(undefined);
      return;
    }

    setSelectedPlayerLoading(true);
    void requestJson<PlayerDetail>(`/api/stats/season/${seasonId}/player/${selectedPlayer.id}`)
      .then(setSelectedPlayerDetail)
      .finally(() => setSelectedPlayerLoading(false));
  }, [seasonId, selectedPlayer]);

  const statsByPlayerId = useMemo(
    () => new Map(stats.map((item) => [item.playerId, item])),
    [stats]
  );

  const playerCards = useMemo<PlayerCardData[]>(
    () =>
      players
        .map((player) => ({ player, stats: statsByPlayerId.get(player.id) }))
        .sort((a, b) => {
          const scoreA = (a.stats?.internalSeasonPoints ?? 0) + (a.stats?.totalGoals ?? 0);
          const scoreB = (b.stats?.internalSeasonPoints ?? 0) + (b.stats?.totalGoals ?? 0);
          if (scoreB !== scoreA) return scoreB - scoreA;
          return a.player.name.localeCompare(b.player.name, "zh-CN");
        }),
    [players, statsByPlayerId]
  );

  const rankingDefinitions = useMemo<RankingDefinition[]>(() => {
    if (rankingScope === "external") {
      return [
        {
          key: "external-appearances",
          title: "出勤榜",
          icon: <Activity size={18} />,
          rows: rankBy(stats, (row) => row.externalAppearances),
          valueGetter: (row) => row.externalAppearances,
          metricLabel: "场"
        },
        {
          key: "external-goals",
          title: "射手榜",
          icon: <Target size={18} />,
          rows: rankBy(stats, (row) => row.externalGoals),
          valueGetter: (row) => row.externalGoals,
          metricLabel: "球"
        },
        {
          key: "external-assists",
          title: "助攻榜",
          icon: <Handshake size={18} />,
          rows: rankBy(stats, (row) => row.externalAssists),
          valueGetter: (row) => row.externalAssists,
          metricLabel: "助"
        }
      ];
    }

    return [
      {
        key: "internal-points",
        title: "积分榜",
        icon: <Medal size={18} />,
        rows: rankBy(stats, (row) => row.internalSeasonPoints),
        valueGetter: (row) => row.internalSeasonPoints,
        metricLabel: "分"
      },
      {
        key: "internal-goals",
        title: "射手榜",
        icon: <Target size={18} />,
        rows: rankBy(stats, (row) => row.internalGoals),
        valueGetter: (row) => row.internalGoals,
        metricLabel: "球"
      },
      {
        key: "internal-assists",
        title: "助攻榜",
        icon: <Handshake size={18} />,
        rows: rankBy(stats, (row) => row.internalAssists),
        valueGetter: (row) => row.internalAssists,
        metricLabel: "助"
      },
      {
        key: "internal-appearances",
        title: "出勤榜",
        icon: <Activity size={18} />,
        rows: rankBy(stats, (row) => row.internalAppearances),
        valueGetter: (row) => row.internalAppearances,
        metricLabel: "场"
      },
      {
        key: "internal-points-rate",
        title: "场均积分",
        icon: <TrendingUp size={18} />,
        rows: rankBy(stats, (row) =>
          safeAverage(row.internalSeasonPoints, row.internalAppearances)
        ),
        valueGetter: (row) => safeAverage(row.internalSeasonPoints, row.internalAppearances),
        metricLabel: "分/场",
        formatter: formatRate
      },
      {
        key: "internal-goals-rate",
        title: "场均进球",
        icon: <Trophy size={18} />,
        rows: rankBy(stats, (row) => safeAverage(row.internalGoals, row.internalAppearances)),
        valueGetter: (row) => safeAverage(row.internalGoals, row.internalAppearances),
        metricLabel: "球/场",
        formatter: formatRate
      }
    ];
  }, [rankingScope, stats]);

  const selectedStats =
    selectedPlayerDetail?.stats ??
    (selectedPlayer ? statsByPlayerId.get(selectedPlayer.id) : undefined);
  const currentSeason = seasons.find((season) => season.id === seasonId);

  const summary = useMemo(() => {
    const confirmedMatchDays = matchDays.filter(
      (matchDay) => matchDay.seasonId === seasonId && matchDay.parseStatus === "CONFIRMED"
    ).length;
    return {
      players: players.filter((player) => player.status === "ACTIVE").length || players.length,
      confirmedMatchDays,
      goals: stats.reduce((sum, item) => sum + item.totalGoals, 0),
      assists: stats.reduce((sum, item) => sum + item.totalAssists, 0),
      points: stats.reduce((sum, item) => sum + item.internalSeasonPoints, 0)
    };
  }, [matchDays, players, seasonId, stats]);

  function toggleBoard(boardKey: string) {
    setExpandedBoards((current) => ({ ...current, [boardKey]: !current[boardKey] }));
  }

  return (
    <main className="public-page">
      <div className="public-topbar">
        <div className="public-brand">
          <Trophy size={22} />
          <span>{TEAM_NAME}</span>
        </div>
        <Button icon={<Shield size={16} />} onClick={() => setLoginOpen(true)}>
          后台
        </Button>
      </div>

      <section className="public-hero">
        <div className="public-hero-copy">
          <Tag color="green">{currentSeason?.name ?? "球队数据"}</Tag>
          <h1>{TEAM_NAME}</h1>
          <p>球队数据中心，集中查看积分、进球、助攻、出勤和场均表现。</p>
        </div>
        <div className="public-season-tools">
          <Select
            className="public-season-select"
            value={seasonId}
            options={seasons.map((season) => ({ label: season.name, value: season.id }))}
            onChange={(value) => {
              setSeasonId(value);
              void load(value);
            }}
            placeholder="选择赛季"
          />
          <Button icon={<RefreshCw size={16} />} onClick={() => load()} loading={loading}>
            刷新
          </Button>
        </div>
      </section>

      {loadError ? <div className="public-alert">{loadError}</div> : null}

      <Spin spinning={loading}>
        <div className="public-content-layout">
          <div className="public-main-column">
        <section className="public-summary-grid">
          <div className="public-summary-card">
            <UserRound size={20} />
            <span>球员</span>
            <strong>{summary.players}</strong>
          </div>
          <div className="public-summary-card">
            <CalendarDays size={20} />
            <span>已确认比赛日</span>
            <strong>{summary.confirmedMatchDays}</strong>
          </div>
          <div className="public-summary-card">
            <Target size={20} />
            <span>总进球</span>
            <strong>{summary.goals}</strong>
          </div>
          <div className="public-summary-card">
            <Handshake size={20} />
            <span>总助攻</span>
            <strong>{summary.assists}</strong>
          </div>
          <div className="public-summary-card">
            <Medal size={20} />
            <span>队内积分</span>
            <strong>{summary.points}</strong>
          </div>
        </section>

        {seasons.length === 0 ? (
          <section className="public-section">
            <Empty description="还没有可展示的赛季数据" />
          </section>
        ) : (
          <>
            <section className="public-section">
              <div className="public-section-heading">
                <h2>赛季榜单</h2>
                <div className="public-section-actions">
                  <Segmented
                    value={rankingScope}
                    options={[
                      { label: "队内赛", value: "internal" },
                      { label: "队外赛", value: "external" }
                    ]}
                    onChange={(value) => setRankingScope(value as RankingScope)}
                  />
                </div>
              </div>
              <div className="public-ranking-grid">
                {rankingDefinitions.map((definition) => (
                  <RankingBoard
                    key={definition.key}
                    title={definition.title}
                    icon={definition.icon}
                    rows={definition.rows}
                    valueGetter={definition.valueGetter}
                    metricLabel={definition.metricLabel}
                    formatter={definition.formatter}
                    expanded={Boolean(expandedBoards[definition.key])}
                    onToggleExpanded={() => toggleBoard(definition.key)}
                  />
                ))}
              </div>
            </section>

            <section className="public-section">
              <div className="public-section-heading">
                <h2>球员阵容</h2>
              </div>
              <div className="public-roster-grid">
                {playerCards.map(({ player, stats: playerStats }) => (
                  <button
                    className="public-player-card"
                    key={player.id}
                    type="button"
                    onClick={() => setSelectedPlayer(player)}
                  >
                    <PlayerAvatar player={player} className="public-avatar" showJersey />
                    <strong>{player.name}</strong>
                    <span>{player.position ?? "球员"}</span>
                    <div className="public-player-metrics">
                      <span>{playerStats?.internalSeasonPoints ?? 0} 分</span>
                      <span>{playerStats?.totalGoals ?? 0} 球</span>
                      <span>{playerStats?.totalAssists ?? 0} 助</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
          </div>
          <div className="public-side-column">
            <TeamStyleRail photos={teamPhotos} />
          </div>
        </div>
      </Spin>

      <Drawer
        width={520}
        open={Boolean(selectedPlayer)}
        onClose={() => setSelectedPlayer(undefined)}
        title={
          selectedPlayer ? (
            <div className="public-drawer-title">
              <PlayerAvatar player={selectedPlayer} className="public-mini-avatar" />
              <span>{selectedPlayer.name}</span>
            </div>
          ) : null
        }
      >
        {selectedPlayer ? (
          <>
            <div className="public-player-profile">
              <Tag color={selectedPlayer.status === "ACTIVE" ? "green" : "default"}>
                {selectedPlayer.status === "ACTIVE" ? "活跃" : "停用"}
              </Tag>
              <span>{selectedPlayer.position ?? "未设置位置"}</span>
              <span>{selectedPlayer.jerseyNumber ? `#${selectedPlayer.jerseyNumber}` : "暂无号码"}</span>
            </div>
            <div className="public-detail-grid">
              <div>
                <span>进球数</span>
                <strong>{selectedStats?.totalGoals ?? 0}</strong>
              </div>
              <div>
                <span>助攻数</span>
                <strong>{selectedStats?.totalAssists ?? 0}</strong>
              </div>
              <div>
                <span>得分数</span>
                <strong>{selectedStats?.internalSeasonPoints ?? 0}</strong>
              </div>
              <div>
                <span>出勤</span>
                <strong>{selectedStats?.totalAppearances ?? 0}</strong>
              </div>
              <div>
                <span>场均得分</span>
                <strong>{formatRate(selectedStats?.pointsPerInternalAppearance)}</strong>
              </div>
              <div>
                <span>场均进球</span>
                <strong>{formatRate(selectedStats?.goalsPerAppearance)}</strong>
              </div>
              <div>
                <span>队内进球</span>
                <strong>{selectedStats?.internalGoals ?? 0}</strong>
              </div>
              <div>
                <span>队外进球</span>
                <strong>{selectedStats?.externalGoals ?? 0}</strong>
              </div>
              <div>
                <span>队内助攻</span>
                <strong>{selectedStats?.internalAssists ?? 0}</strong>
              </div>
              <div>
                <span>队外助攻</span>
                <strong>{selectedStats?.externalAssists ?? 0}</strong>
              </div>
            </div>
            <div className="public-change-panel">
              <h3>最近数据变动</h3>
              <Spin spinning={selectedPlayerLoading}>
                {selectedPlayerDetail?.recentChanges?.length ? (
                  <div className="public-change-list">
                    {selectedPlayerDetail.recentChanges.map((change) => (
                      <div className="public-change-item" key={change.id}>
                        {change.description}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变动记录" />
                )}
              </Spin>
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal
        title="管理员登录"
        open={loginOpen}
        footer={null}
        onCancel={() => setLoginOpen(false)}
        destroyOnClose
      >
        <Form<LoginValues> layout="vertical" onFinish={login}>
          <Form.Item name="username" label="管理员账号" rules={[{ required: true, message: "请输入管理员账号" }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="管理员密码" rules={[{ required: true, message: "请输入管理员密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button
            block
            type="primary"
            htmlType="submit"
            icon={<LockKeyhole size={16} />}
            loading={loginLoading}
          >
            进入后台
          </Button>
        </Form>
      </Modal>
    </main>
  );
}
