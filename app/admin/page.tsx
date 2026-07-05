"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Empty, Select, Table, Tag } from "antd";
import { Plus, RefreshCw } from "lucide-react";
import type { ColumnsType } from "antd/es/table";
import type { MatchDay, Player, PlayerStats, Season } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

export default function AdminDashboardPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchDays, setMatchDays] = useState<MatchDay[]>([]);
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [seasonId, setSeasonId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load(nextSeasonId?: string) {
    setLoading(true);
    try {
      setLoadError(undefined);
      const [playerRows, seasonRows, matchRows] = await Promise.all([
        requestJson<Player[]>("/api/players"),
        requestJson<Season[]>("/api/seasons"),
        requestJson<MatchDay[]>("/api/matchdays")
      ]);
      setPlayers(playerRows);
      setSeasons(seasonRows);
      setMatchDays(matchRows);
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
      setLoadError(error instanceof Error ? error.message : "加载控制台数据失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    void requestJson<PlayerStats[]>(`/api/stats/season/${seasonId}/players`).then(setStats);
  }, [seasonId]);

  const confirmedMatchDays = useMemo(
    () => matchDays.filter((matchDay) => matchDay.parseStatus === "CONFIRMED").length,
    [matchDays]
  );

  const topScorers = [...stats].sort((a, b) => b.totalGoals - a.totalGoals).slice(0, 8);
  const columns: ColumnsType<PlayerStats> = [
    { title: "球员", dataIndex: "name" },
    { title: "进球", dataIndex: "totalGoals", width: 90 },
    { title: "助攻", dataIndex: "totalAssists", width: 90 },
    { title: "出勤", dataIndex: "totalAppearances", width: 90 },
    { title: "队内积分", dataIndex: "internalSeasonPoints", width: 110 }
  ];

  return (
    <>
      <div className="page-title">
        <div>
          <h1>控制台</h1>
          <p>赛季、比赛、球员与榜单的当前状态</p>
        </div>
        <div className="toolbar">
          <Select
            style={{ width: 220 }}
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
          <Link href="/matchdays/internal">
            <Button type="primary" icon={<Plus size={16} />}>
              录入队内赛
            </Button>
          </Link>
        </div>
      </div>

      <div className="metric-grid">
        {loadError ? (
          <div className="section-panel" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
            <span className="warning-text">{loadError}</span>
          </div>
        ) : null}
        <div className="metric-card">
          <span>球员</span>
          <strong>{players.length}</strong>
        </div>
        <div className="metric-card">
          <span>赛季</span>
          <strong>{seasons.length}</strong>
        </div>
        <div className="metric-card">
          <span>比赛日</span>
          <strong>{matchDays.length}</strong>
        </div>
        <div className="metric-card">
          <span>已确认</span>
          <strong>{confirmedMatchDays}</strong>
        </div>
      </div>

      <div className="section-panel">
        {seasons.length === 0 ? (
          <Empty description="还没有赛季">
            <Link href="/seasons">
              <Button type="primary">创建赛季</Button>
            </Link>
          </Empty>
        ) : (
          <Table
            rowKey="playerId"
            loading={loading}
            columns={columns}
            dataSource={topScorers}
            pagination={false}
            title={() => (
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <Tag color="green">射手榜</Tag>
                <Link href="/rankings">查看完整榜单</Link>
              </div>
            )}
          />
        )}
      </div>
    </>
  );
}
