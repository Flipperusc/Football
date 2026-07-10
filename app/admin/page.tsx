"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { App, Button, Empty, Select, Table, Tag, Upload } from "antd";
import { ImagePlus, Plus, RefreshCw, Save } from "lucide-react";
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
