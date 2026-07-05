"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Empty, Select, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw } from "lucide-react";
import type { PlayerStats, Season } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

type RankingPayload = {
  goals: PlayerStats[];
  assists: PlayerStats[];
  appearances: PlayerStats[];
  internalPoints: PlayerStats[];
  goalsPerAppearance: PlayerStats[];
  pointsPerInternalAppearance: PlayerStats[];
};

const baseColumns: ColumnsType<PlayerStats> = [
  {
    title: "球员",
    dataIndex: "name",
    render: (_, row) => <Link href={`/players/${row.playerId}`}>{row.name}</Link>
  },
  { title: "队内进球", dataIndex: "internalGoals" },
  { title: "队内助攻", dataIndex: "internalAssists" },
  { title: "队内出勤", dataIndex: "internalAppearances" },
  { title: "队内积分", dataIndex: "internalSeasonPoints" },
  { title: "队外进球", dataIndex: "externalGoals" },
  { title: "队外助攻", dataIndex: "externalAssists" },
  { title: "队外出勤", dataIndex: "externalAppearances" },
  { title: "总进球", dataIndex: "totalGoals" },
  { title: "总助攻", dataIndex: "totalAssists" },
  { title: "总出勤", dataIndex: "totalAppearances" },
  { title: "场均进球", dataIndex: "goalsPerAppearance" },
  { title: "场均积分", dataIndex: "pointsPerInternalAppearance" }
];

function topColumns(metricTitle: string, metricKey: keyof PlayerStats): ColumnsType<PlayerStats> {
  return [
    {
      title: "排名",
      width: 80,
      render: (_, __, index) => index + 1
    },
    {
      title: "球员",
      dataIndex: "name",
      render: (_, row) => <Link href={`/players/${row.playerId}`}>{row.name}</Link>
    },
    { title: metricTitle, dataIndex: metricKey }
  ];
}

export default function RankingsPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string>();
  const [rankings, setRankings] = useState<RankingPayload>();
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(false);

  async function load(nextSeasonId?: string) {
    setLoading(true);
    try {
      const seasonRows = seasons.length ? seasons : await requestJson<Season[]>("/api/seasons");
      if (!seasons.length) setSeasons(seasonRows);
      const id =
        nextSeasonId ??
        seasonId ??
        (typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("seasonId") ?? undefined
          : undefined) ??
        seasonRows.find((season) => season.status === "ACTIVE")?.id ??
        seasonRows[0]?.id;
      setSeasonId(id);
      if (id) {
        const [rankingRows, playerRows] = await Promise.all([
          requestJson<RankingPayload>(`/api/stats/season/${id}/rankings`),
          requestJson<PlayerStats[]>(`/api/stats/season/${id}/players`)
        ]);
        setRankings(rankingRows);
        setPlayers(playerRows);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (!seasonId && !loading) {
    return (
      <div className="section-panel">
        <Empty description="还没有赛季" />
      </div>
    );
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>赛季榜单</h1>
          <p>队内赛、队外赛和总数据按数据库事件重新计算</p>
        </div>
        <div className="toolbar">
          <Select
            style={{ width: 240 }}
            value={seasonId}
            options={seasons.map((season) => ({ label: season.name, value: season.id }))}
            onChange={(value) => {
              setSeasonId(value);
              void load(value);
            }}
          />
          <Button icon={<RefreshCw size={16} />} onClick={() => load()} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: "all",
            label: "总数据",
            children: (
              <div className="section-panel">
                <Table
                  rowKey="playerId"
                  loading={loading}
                  columns={baseColumns}
                  dataSource={players}
                  scroll={{ x: 1200 }}
                />
              </div>
            )
          },
          {
            key: "goals",
            label: "射手榜",
            children: (
              <div className="section-panel">
                <Tag color="green">总进球</Tag>
                <Table
                  rowKey="playerId"
                  loading={loading}
                  columns={topColumns("进球", "totalGoals")}
                  dataSource={rankings?.goals ?? []}
                />
              </div>
            )
          },
          {
            key: "assists",
            label: "助攻榜",
            children: (
              <div className="section-panel">
                <Table
                  rowKey="playerId"
                  loading={loading}
                  columns={topColumns("助攻", "totalAssists")}
                  dataSource={rankings?.assists ?? []}
                />
              </div>
            )
          },
          {
            key: "attendance",
            label: "出勤榜",
            children: (
              <div className="section-panel">
                <Table
                  rowKey="playerId"
                  loading={loading}
                  columns={topColumns("出勤", "totalAppearances")}
                  dataSource={rankings?.appearances ?? []}
                />
              </div>
            )
          },
          {
            key: "points",
            label: "队内积分",
            children: (
              <div className="section-panel">
                <Table
                  rowKey="playerId"
                  loading={loading}
                  columns={topColumns("积分", "internalSeasonPoints")}
                  dataSource={rankings?.internalPoints ?? []}
                />
              </div>
            )
          },
          {
            key: "rates",
            label: "场均",
            children: (
              <div className="section-panel">
                <Table
                  rowKey="playerId"
                  loading={loading}
                  columns={[
                    ...topColumns("场均进球", "goalsPerAppearance"),
                    { title: "场均积分", dataIndex: "pointsPerInternalAppearance" }
                  ]}
                  dataSource={rankings?.goalsPerAppearance ?? []}
                />
              </div>
            )
          }
        ]}
      />
    </>
  );
}
