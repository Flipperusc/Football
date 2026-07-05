"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Descriptions, Empty, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Player, PlayerStats, Season } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

type PlayerDetail = {
  player: Player;
  stats?: PlayerStats;
  matchRecords: {
    id: string;
    date: string;
    type: "INTERNAL" | "EXTERNAL";
    parseStatus: string;
    goalEvents: {
      id: string;
      count: number;
      rawText?: string;
      scorerId: string;
      assistPlayerId?: string | null;
    }[];
    playerPoints: {
      totalPoints: number;
      basePoints: number;
      bonusPoints: number;
    }[];
  }[];
};

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<string>();
  const [detail, setDetail] = useState<PlayerDetail>();
  const [loading, setLoading] = useState(false);

  async function load(nextSeasonId?: string) {
    setLoading(true);
    try {
      const seasonRows = seasons.length ? seasons : await requestJson<Season[]>("/api/seasons");
      if (!seasons.length) setSeasons(seasonRows);
      const id =
        nextSeasonId ??
        seasonId ??
        seasonRows.find((season) => season.status === "ACTIVE")?.id ??
        seasonRows[0]?.id;
      setSeasonId(id);
      if (id) {
        setDetail(await requestJson<PlayerDetail>(`/api/stats/season/${id}/player/${params.id}`));
      } else {
        const player = await requestJson<Player>(`/api/players/${params.id}`);
        setDetail({ player, matchRecords: [] });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  const columns: ColumnsType<PlayerDetail["matchRecords"][number]> = [
    { title: "日期", dataIndex: "date", render: (value: string) => value.slice(0, 10) },
    {
      title: "类型",
      dataIndex: "type",
      render: (type: string) => (type === "INTERNAL" ? "队内赛" : "队外赛")
    },
    { title: "进球/助攻事件", render: (_, row) => row.goalEvents.length },
    {
      title: "积分",
      render: (_, row) => row.playerPoints[0]?.totalPoints ?? "-"
    },
    {
      title: "状态",
      dataIndex: "parseStatus",
      render: (status: string) => <Tag>{status}</Tag>
    }
  ];

  if (!detail && !loading) {
    return (
      <div className="section-panel">
        <Empty description="未找到球员" />
      </div>
    );
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h1>{detail?.player.name ?? "球员详情"}</h1>
          <p>基础信息、本赛季数据、历史比赛记录、进球和助攻明细</p>
        </div>
        <Select
          style={{ width: 240 }}
          value={seasonId}
          options={seasons.map((season) => ({ label: season.name, value: season.id }))}
          onChange={(value) => {
            setSeasonId(value);
            void load(value);
          }}
        />
      </div>

      <div className="section-panel">
        <Descriptions bordered column={{ xs: 1, md: 3 }}>
          <Descriptions.Item label="姓名">{detail?.player.name}</Descriptions.Item>
          <Descriptions.Item label="号码">{detail?.player.jerseyNumber ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="位置">{detail?.player.position ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="状态">
            {detail?.player.status === "ACTIVE" ? "活跃" : "停用"}
          </Descriptions.Item>
          <Descriptions.Item label="别名" span={2}>
            <Space wrap>
              {(detail?.player.aliases ?? []).map((alias) => (
                <Tag key={alias.id}>{alias.alias}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span>总进球</span>
          <strong>{detail?.stats?.totalGoals ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>总助攻</span>
          <strong>{detail?.stats?.totalAssists ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>总出勤</span>
          <strong>{detail?.stats?.totalAppearances ?? 0}</strong>
        </div>
        <div className="metric-card">
          <span>队内积分</span>
          <strong>{detail?.stats?.internalSeasonPoints ?? 0}</strong>
        </div>
      </div>

      <div className="section-panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={detail?.matchRecords ?? []}
        />
      </div>
    </>
  );
}
