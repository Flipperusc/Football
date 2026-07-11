"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { App, Button, Empty, Popconfirm, Select, Table, Tag, Upload } from "antd";
import { ImagePlus, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type { ColumnsType } from "antd/es/table";
import type { MatchDay, Player, PlayerStats, Season, TeamSetting } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";
import { getDisplayImageUrl, normalizeImageUrl } from "@/lib/image-url";

function TeamLogoUpload({
  value,
  onChange
}: {
  value?: string;
  onChange?: (value?: string) => void;
}) {
  const previewUrl = getDisplayImageUrl(value);

  return (
    <div className="team-logo-upload-field">
      <Upload.Dragger
        accept="image/jpeg,image/png,image/webp"
        customRequest={(options) => {
          const uploadFile = options.file;
          if (!(uploadFile instanceof File)) {
            options.onError?.(new Error("请选择本地图片文件"));
            return;
          }

          const body = new FormData();
          body.append("file", uploadFile);

          fetch("/api/uploads/team-logo", { method: "POST", body })
            .then(async (response) => {
              if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { message?: string } | null;
                throw new Error(payload?.message ?? "球队 Logo 上传失败");
              }
              return response.json() as Promise<{ url: string }>;
            })
            .then((payload) => {
              onChange?.(normalizeImageUrl(payload.url));
              options.onSuccess?.(payload);
            })
            .catch((error) => {
              options.onError?.(error instanceof Error ? error : new Error("球队 Logo 上传失败"));
            });
        }}
        maxCount={1}
        showUploadList={false}
      >
        <div className="team-logo-upload-content">
          {previewUrl ? (
            <img src={previewUrl} alt="球队 Logo 预览" />
          ) : (
            <span className="team-logo-upload-placeholder"><ImagePlus size={30} /></span>
          )}
          <div>
            <strong>点击上传或拖入球队 Logo</strong>
            <span>建议使用正方形图片，支持 JPG、PNG、WEBP，最大 4MB</span>
          </div>
        </div>
      </Upload.Dragger>
      {value ? (
        <Button size="small" onClick={() => onChange?.(undefined)}>移除 Logo</Button>
      ) : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  const { message } = App.useApp();
  const [players, setPlayers] = useState<Player[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [matchDays, setMatchDays] = useState<MatchDay[]>([]);
  const [deletingMatchDayId, setDeletingMatchDayId] = useState<string>();
  const [stats, setStats] = useState<PlayerStats[]>([]);
  const [seasonId, setSeasonId] = useState<string>();
  const [logoDraft, setLogoDraft] = useState<string>();
  const [logoSaving, setLogoSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load(nextSeasonId?: string) {
    setLoading(true);
    try {
      setLoadError(undefined);
      const [playerRows, seasonRows, matchRows, settings] = await Promise.all([
        requestJson<Player[]>("/api/players"),
        requestJson<Season[]>("/api/seasons"),
        requestJson<MatchDay[]>("/api/matchdays"),
        requestJson<TeamSetting>("/api/team-settings")
      ]);
      setPlayers(playerRows);
      setSeasons(seasonRows);
      setMatchDays(matchRows);
      setLogoDraft(settings.logoUrl ?? undefined);
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

  async function saveTeamLogo() {
    setLogoSaving(true);
    try {
      const settings = await requestJson<TeamSetting>("/api/team-settings", {
        method: "PATCH",
        body: JSON.stringify({ logoUrl: normalizeImageUrl(logoDraft) || null })
      });
      setLogoDraft(settings.logoUrl ?? undefined);
      message.success("球队 Logo 已保存并同步到首页");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "球队 Logo 保存失败");
    } finally {
      setLogoSaving(false);
    }
  }

  async function deleteMatchDay(matchDay: MatchDay) {
    setDeletingMatchDayId(matchDay.id);
    try {
      await requestJson<{ ok: true }>(`/api/matchdays/${matchDay.id}`, {
        method: "DELETE"
      });
      message.success(`${matchDay.date.slice(0, 10)} \u7684${matchDay.type === "INTERNAL" ? "\u961f\u5185\u8d5b" : "\u961f\u5916\u8d5b"}\u5f55\u5165\u5df2\u5220\u9664`);
      await load(seasonId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "\u5220\u9664\u6bd4\u8d5b\u5f55\u5165\u5931\u8d25");
    } finally {
      setDeletingMatchDayId(undefined);
    }
  }

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


  const matchDayColumns: ColumnsType<MatchDay> = [
    {
      title: "\u6bd4\u8d5b\u65e5\u671f",
      dataIndex: "date",
      width: 130,
      render: (date: string) => date.slice(0, 10)
    },
    {
      title: "\u8d5b\u5b63",
      width: 180,
      render: (_, matchDay) => matchDay.season?.name ?? "-"
    },
    {
      title: "\u7c7b\u578b",
      width: 100,
      render: (_, matchDay) => (
        <Tag color={matchDay.type === "INTERNAL" ? "blue" : "cyan"}>
          {matchDay.type === "INTERNAL" ? "\u961f\u5185\u8d5b" : "\u961f\u5916\u8d5b"}
        </Tag>
      )
    },
    {
      title: "\u72b6\u6001",
      width: 110,
      render: (_, matchDay) => {
        const statusMap = {
          PENDING: { label: "\u5f85\u89e3\u6790", color: "default" },
          PARSED: { label: "\u5f85\u786e\u8ba4", color: "gold" },
          CONFIRMED: { label: "\u5df2\u5165\u5e93", color: "green" },
          FAILED: { label: "\u89e3\u6790\u5931\u8d25", color: "red" }
        } as const;
        const status = statusMap[matchDay.parseStatus];
        return <Tag color={status.color}>{status.label}</Tag>;
      }
    },
    {
      title: "\u64cd\u4f5c",
      width: 110,
      fixed: "right",
      render: (_, matchDay) => (
        <Popconfirm
          title={`\u786e\u5b9a\u5220\u9664 ${matchDay.date.slice(0, 10)} \u7684${matchDay.type === "INTERNAL" ? "\u961f\u5185\u8d5b" : "\u961f\u5916\u8d5b"}\u5f55\u5165\u5417\uff1f`}
          description="\u8be5\u573a\u7684\u6bd4\u5206\u3001\u8fdb\u7403\u3001\u52a9\u653b\u3001\u51fa\u52e4\u3001\u79ef\u5206\u3001\u5956\u9879\u548c\u89e3\u6790\u8bb0\u5f55\u5c06\u4e00\u5e76\u5220\u9664\uff0c\u4e14\u65e0\u6cd5\u6062\u590d\u3002"
          okText="\u786e\u8ba4\u5220\u9664"
          cancelText="\u53d6\u6d88"
          okButtonProps={{ danger: true }}
          onConfirm={() => deleteMatchDay(matchDay)}
        >
          <Button danger size="small" icon={<Trash2 size={15} />} loading={deletingMatchDayId === matchDay.id}>
            {"\u5220\u9664"}
          </Button>
        </Popconfirm>
      )
    }
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

      <div className="section-panel team-brand-settings-panel">
        <div className="team-brand-settings-copy">
          <span>首页品牌</span>
          <h2>球队 Logo</h2>
          <p>上传后将展示在首页品牌区右侧，并同步作为顶部导航的品牌图标。</p>
          <Button type="primary" icon={<Save size={16} />} loading={logoSaving} onClick={saveTeamLogo}>
            保存 Logo
          </Button>
        </div>
        <TeamLogoUpload value={logoDraft} onChange={setLogoDraft} />
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
        <Table
          rowKey="id"
          loading={loading}
          columns={matchDayColumns}
          dataSource={matchDays}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          scroll={{ x: 720 }}
          locale={{ emptyText: "\u6682\u65e0\u6bd4\u8d5b\u5f55\u5165" }}
          title={() => (
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <Tag color="blue">{"\u6bd4\u8d5b\u5f55\u5165\u7ba1\u7406"}</Tag>
              <span className="muted-text">{"\u5220\u9664\u9519\u8bef\u5f55\u5165\u540e\uff0c\u699c\u5355\u4f1a\u6309\u5269\u4f59\u6bd4\u8d5b\u6570\u636e\u91cd\u65b0\u8ba1\u7b97"}</span>
            </div>
          )}
        />
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
