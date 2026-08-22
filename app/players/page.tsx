"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Upload
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Save, Search, SlidersHorizontal, Trash2, UserPlus, X } from "lucide-react";
import { PlayerBulkImport } from "@/components/PlayerBulkImport";
import type { Player, Season } from "@/lib/client-types";
import { getRequestErrorMessage, requestJson } from "@/lib/client-types";
import { getDisplayImageUrl, normalizeImageUrl } from "@/lib/image-url";
import { filterPlayersByName } from "@/lib/player-search";
import {
  formatStatAdjustmentValue,
  statAdjustmentMetricLabels
} from "@/lib/stat-adjustments";

type PlayerFormValues = {
  name: string;
  jerseyNumber?: number;
  position?: string;
  avatarUrl?: string;
  status?: "ACTIVE" | "INACTIVE";
  aliasesText?: string;
};

const positionOptions = [
  { value: "前锋" },
  { value: "中场" },
  { value: "后卫" },
  { value: "门将" }
];

type StatMetric =
  | "INTERNAL_GOALS"
  | "INTERNAL_ASSISTS"
  | "INTERNAL_APPEARANCES"
  | "INTERNAL_SEASON_POINTS"
  | "EXTERNAL_GOALS"
  | "EXTERNAL_ASSISTS"
  | "EXTERNAL_APPEARANCES";

type StatOperation = "SET" | "ADJUST";

type AdjustmentFormValues = {
  seasonId: string;
  metric: StatMetric;
  operation: StatOperation;
  value: number;
  reason: string;
};

type StatAdjustment = {
  id: string;
  seasonId: string;
  metric: StatMetric;
  operation: StatOperation;
  value: number;
  reason: string;
  createdAt: string;
  season?: Season;
};

const metricOptions: { label: string; value: StatMetric }[] = [
  { label: "队内赛积分", value: "INTERNAL_SEASON_POINTS" },
  { label: "队内进球", value: "INTERNAL_GOALS" },
  { label: "队内助攻", value: "INTERNAL_ASSISTS" },
  { label: "队外进球", value: "EXTERNAL_GOALS" },
  { label: "队外助攻", value: "EXTERNAL_ASSISTS" },
  { label: "队内出勤", value: "INTERNAL_APPEARANCES" },
  { label: "队外出勤", value: "EXTERNAL_APPEARANCES" }
];

const metricLabels = statAdjustmentMetricLabels as Record<StatMetric, string>;

function avatarLabel(player: Player) {
  return Array.from(player.name.trim()).slice(0, 2).join("") || "球";
}

function PlayerAvatar({ player }: { player: Player }) {
  const avatarSrc = getDisplayImageUrl(player.avatarUrl);

  return (
    <span className="admin-player-avatar">
      {avatarSrc ? <img src={avatarSrc} alt={player.name} /> : avatarLabel(player)}
    </span>
  );
}

function AvatarUpload({ value, onChange }: { value?: string; onChange?: (value?: string) => void }) {
  const previewUrl = getDisplayImageUrl(value);

  return (
    <div className="avatar-upload-field">
      <Upload.Dragger
        accept="image/*"
        customRequest={(options) => {
          const uploadFile = options.file;
          if (!(uploadFile instanceof File)) {
            options.onError?.(new Error("请选择本地图片文件"));
            return;
          }

          const body = new FormData();
          body.append("file", uploadFile);

          fetch("/api/uploads/player-avatar", {
            method: "POST",
            body
          })
            .then(async (response) => {
              if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { message?: string } | null;
                throw new Error(payload?.message ?? "头像上传失败");
              }
              return response.json() as Promise<{ url: string }>;
            })
            .then((payload) => {
              onChange?.(payload.url);
              options.onSuccess?.(payload);
            })
            .catch((error) => {
              options.onError?.(error instanceof Error ? error : new Error("头像上传失败"));
            });
        }}
        maxCount={1}
        showUploadList={false}
      >
        <div className="avatar-upload-content">
          {previewUrl ? (
            <span className="admin-player-avatar admin-player-avatar-large">
              <img src={previewUrl} alt="球员头像" />
            </span>
          ) : (
            <span className="avatar-upload-placeholder">+</span>
          )}
          <div>
            <strong>点击上传或拖入头像</strong>
            <span>支持 JPG、PNG、WEBP、GIF，最大 5MB</span>
          </div>
        </div>
      </Upload.Dragger>
      {value ? (
        <Button size="small" style={{ marginTop: 8 }} onClick={() => onChange?.(undefined)}>
          移除头像
        </Button>
      ) : null}
    </div>
  );
}

export default function PlayersPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<PlayerFormValues>();
  const [editForm] = Form.useForm<PlayerFormValues>();
  const [adjustmentForm] = Form.useForm<AdjustmentFormValues>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [adjustments, setAdjustments] = useState<StatAdjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [adjustmentLoading, setAdjustmentLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [editing, setEditing] = useState<Player | null>(null);
  const [adjusting, setAdjusting] = useState<Player | null>(null);
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});
  const [deletingAliasId, setDeletingAliasId] = useState<string | null>(null);
  const deleteAliasInFlight = useRef(false);

  async function load() {
    setLoading(true);
    try {
      const [playerRows, seasonRows] = await Promise.all([
        requestJson<Player[]>("/api/players"),
        requestJson<Season[]>("/api/seasons")
      ]);
      setPlayers(playerRows);
      setSeasons(seasonRows);
    } finally {
      setLoading(false);
    }
  }

  async function loadAdjustments(playerId: string, seasonId?: string) {
    setAdjustmentLoading(true);
    try {
      const query = seasonId ? `?seasonId=${seasonId}` : "";
      setAdjustments(
        await requestJson<StatAdjustment[]>(`/api/players/${playerId}/stat-adjustments${query}`)
      );
    } finally {
      setAdjustmentLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createPlayer(values: PlayerFormValues) {
    try {
      await requestJson<Player>("/api/players", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          jerseyNumber: values.jerseyNumber ?? null,
          position: values.position ?? null,
          avatarUrl: normalizeImageUrl(values.avatarUrl) || null,
          status: values.status ?? "ACTIVE",
          aliases: (values.aliasesText ?? "")
            .split(/[,，\n]/)
            .map((alias) => alias.trim())
            .filter(Boolean)
            .map((alias) => ({ alias, aliasType: "MANUAL" }))
        })
      });
      form.resetFields();
      message.success("已新增球员");
      await load();
    } catch (error) {
      message.error(getRequestErrorMessage(error, "新增球员失败"));
    }
  }

  async function updatePlayer(values: PlayerFormValues) {
    if (!editing) return;
    try {
      await requestJson<Player>(`/api/players/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: values.name,
          jerseyNumber: values.jerseyNumber ?? null,
          position: values.position ?? null,
          avatarUrl: normalizeImageUrl(values.avatarUrl) || null,
          status: values.status ?? "ACTIVE"
        })
      });
      setEditing(null);
      message.success("已更新球员");
      await load();
    } catch (error) {
      message.error(getRequestErrorMessage(error, "更新球员失败"));
    }
  }

  async function addAlias(playerId: string) {
    const alias = aliasInputs[playerId]?.trim();
    if (!alias) return;
    try {
      await requestJson(`/api/players/${playerId}/aliases`, {
        method: "POST",
        body: JSON.stringify({ alias, aliasType: "MANUAL" })
      });
      setAliasInputs((current) => ({ ...current, [playerId]: "" }));
      message.success("已保存别名");
      await load();
    } catch (error) {
      message.error(getRequestErrorMessage(error, "保存球员别名失败"));
    }
  }

  async function deletePlayer(player: Player) {
    setDeletingId(player.id);
    try {
      await requestJson<{ ok: boolean }>(`/api/players/${player.id}`, {
        method: "DELETE"
      });
      message.success(`已删除球员“${player.name}”`);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除球员失败");
    } finally {
      setDeletingId(undefined);
    }
  }

  async function deleteAlias(playerId: string, aliasId: string) {
    if (deleteAliasInFlight.current) return;
    deleteAliasInFlight.current = true;
    setDeletingAliasId(aliasId);
    try {
      await requestJson<void>(`/api/players/${playerId}/aliases/${aliasId}`, { method: "DELETE" });
      message.success("已删除别名");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除别名失败");
    } finally {
      deleteAliasInFlight.current = false;
      setDeletingAliasId(null);
    }
  }

  function openAdjustmentModal(player: Player) {
    const defaultSeasonId = seasons.find((season) => season.status === "ACTIVE")?.id ?? seasons[0]?.id;
    setAdjusting(player);
    adjustmentForm.setFieldsValue({
      seasonId: defaultSeasonId,
      metric: "INTERNAL_SEASON_POINTS",
      operation: "ADJUST",
      value: 1,
      reason: ""
    });
    void loadAdjustments(player.id, defaultSeasonId);
  }

  async function createAdjustment(values: AdjustmentFormValues) {
    if (!adjusting) return;
    await requestJson(`/api/players/${adjusting.id}/stat-adjustments`, {
      method: "POST",
      body: JSON.stringify(values)
    });
    message.success("手动数据变动已保存");
    adjustmentForm.setFieldsValue({ value: 1, reason: "" });
    await loadAdjustments(adjusting.id, values.seasonId);
  }
  const filteredPlayers = useMemo(
    () => filterPlayersByName(players, playerSearch),
    [playerSearch, players]
  );


  const columns: ColumnsType<Player> = [
    {
      title: "头像",
      width: 72,
      render: (_, player) => <PlayerAvatar player={player} />
    },
    {
      title: "姓名",
      dataIndex: "name",
      render: (_, player) => <Link href={`/players/${player.id}`}>{player.name}</Link>
    },
    { title: "号码", dataIndex: "jerseyNumber", width: 90 },
    { title: "位置", dataIndex: "position", width: 120 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (status: Player["status"]) => (
        <Tag color={status === "ACTIVE" ? "green" : "default"}>
          {status === "ACTIVE" ? "活跃" : "停用"}
        </Tag>
      )
    },
    {
      title: "别名",
      dataIndex: "aliases",
      render: (aliases: Player["aliases"], player) => (
        <Space wrap>
          {(aliases ?? []).map((alias) => {
            const isDeleting = deletingAliasId === alias.id;

            return (
              <Tag key={alias.id}>
                {alias.alias}
                {isDeleting ? "（删除中）" : ""}
                <Popconfirm
                  title={`确认删除别名“${alias.alias}”？`}
                  onConfirm={() => deleteAlias(player.id, alias.id)}
                  disabled={deletingAliasId !== null}
                >
                  <Button
                    aria-label={`删除别名 ${alias.alias}`}
                    danger
                    disabled={deletingAliasId !== null}
                    icon={<X size={14} />}
                    loading={isDeleting}
                    size="small"
                    type="text"
                    style={{ height: 18, marginInlineStart: 4, padding: 0, width: 18 }}
                  />
                </Popconfirm>
              </Tag>
            );
          })}
        </Space>
      )
    },
    {
      title: "维护别名",
      width: 260,
      render: (_, player) => (
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={aliasInputs[player.id] ?? ""}
            onChange={(event) =>
              setAliasInputs((current) => ({ ...current, [player.id]: event.target.value }))
            }
            placeholder="新增别名"
          />
          <Button icon={<Plus size={16} />} onClick={() => addAlias(player.id)} />
        </Space.Compact>
      )
    },
    {
      title: "操作",
      width: 280,
      render: (_, player) => (
        <Space>
          <Button
            onClick={() => {
              setEditing(player);
              editForm.setFieldsValue({
                name: player.name,
                jerseyNumber: player.jerseyNumber ?? undefined,
                position: player.position ?? undefined,
                avatarUrl: player.avatarUrl ?? undefined,
                status: player.status
              });
            }}
          >
            编辑
          </Button>
          <Button icon={<SlidersHorizontal size={16} />} onClick={() => openAdjustmentModal(player)}>
            手动加减
          </Button>
          <Popconfirm
            title={`确定删除球员“${player.name}”吗？`}
            description="仅可删除没有比赛或人工数据记录的球员，删除后无法恢复。"
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deletePlayer(player)}
          >
            <Button danger icon={<Trash2 size={16} />} loading={deletingId === player.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const adjustmentColumns: ColumnsType<StatAdjustment> = [
    { title: "时间", dataIndex: "createdAt", render: (value: string) => value.slice(0, 10) },
    { title: "赛季", render: (_, row) => row.season?.name ?? "-" },
    { title: "指标", dataIndex: "metric", render: (metric: StatMetric) => metricLabels[metric] },
    {
      title: "操作",
      render: (_, row) => (
        <Tag color={row.operation === "ADJUST" && row.value < 0 ? "red" : "blue"}>{formatStatAdjustmentValue(row.operation, row.value)}</Tag>
      )
    },
    { title: "原因", dataIndex: "reason" }
  ];

  return (
    <>
      <div className="page-title">
        <div>
          <h1>球员管理</h1>
          <p>维护姓名、号码、位置、头像、别名，并可对球员赛季数据做有原因记录的人工调整。</p>
        </div>
      </div>

      <div className="section-panel">
        <PlayerBulkImport onImported={load} />
      </div>

      <div className="section-panel">
        <Form form={form} layout="vertical" onFinish={createPlayer}>
          <div className="form-grid">
            <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
              <Input placeholder="标准姓名" />
            </Form.Item>
            <Form.Item name="jerseyNumber" label="号码">
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="position" label="位置">
              <AutoComplete options={positionOptions} placeholder="选择或输入位置" />
            </Form.Item>
            <Form.Item name="status" label="状态" initialValue="ACTIVE">
              <Select
                options={[
                  { label: "活跃", value: "ACTIVE" },
                  { label: "停用", value: "INACTIVE" }
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="avatarUrl" label="头像">
            <AvatarUpload />
          </Form.Item>
          <Form.Item name="aliasesText" label="初始别名">
            <Input.TextArea rows={2} placeholder="可用逗号或换行分隔" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<UserPlus size={16} />}>
            新增球员
          </Button>
        </Form>
      </div>

      <div className="section-panel">
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Input
            prefix={<Search size={16} />}
            allowClear
            value={playerSearch}
            onChange={(event) => setPlayerSearch(event.target.value)}
            placeholder="搜索球员姓名或别名"
            aria-label="搜索球员姓名或别名"
            style={{ width: "min(420px, 100%)" }}
          />
          <span className="muted">
            {playerSearch.trim()
              ? `找到 ${filteredPlayers.length} 名球员`
              : `共 ${players.length} 名球员`}
          </span>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredPlayers}
          locale={{ emptyText: playerSearch.trim() ? "未找到匹配的球员" : "暂无球员" }}
          scroll={{ x: 1200 }}
        />
      </div>

      <Modal
        title="编辑球员"
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={updatePlayer}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="jerseyNumber" label="号码">
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="position" label="位置">
            <AutoComplete options={positionOptions} placeholder="选择或输入位置" />
          </Form.Item>
          <Form.Item name="avatarUrl" label="头像">
            <AvatarUpload />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: "活跃", value: "ACTIVE" },
                { label: "停用", value: "INACTIVE" }
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<Save size={16} />}>
            保存
          </Button>
        </Form>
      </Modal>

      <Modal
        title={adjusting ? `手动加减数据：${adjusting.name}` : "手动加减数据"}
        open={Boolean(adjusting)}
        onCancel={() => setAdjusting(null)}
        footer={null}
        width={820}
        destroyOnClose
      >
        <Form form={adjustmentForm} layout="vertical" onFinish={createAdjustment}>
          <div className="form-grid">
            <Form.Item name="seasonId" label="赛季" rules={[{ required: true }]}>
              <Select
                options={seasons.map((season) => ({ label: season.name, value: season.id }))}
                onChange={(seasonId) => {
                  if (adjusting) void loadAdjustments(adjusting.id, seasonId);
                }}
              />
            </Form.Item>
            <Form.Item name="metric" label="指标" rules={[{ required: true }]}>
              <Select options={metricOptions} />
            </Form.Item>
            <Form.Item name="operation" label="方式" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: "增加/减少", value: "ADJUST" },
                  { label: "直接设置为", value: "SET" }
                ]}
              />
            </Form.Item>
            <Form.Item name="value" label="加减数值" extra="输入正数增加，输入负数减少，例如 +2 填 2，-1 填 -1" rules={[{ required: true }]}>
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="原因" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="例如：补录 7.5 队内赛第一节进球" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<Save size={16} />}>
            保存变动记录
          </Button>
        </Form>

        <Table
          style={{ marginTop: 16 }}
          rowKey="id"
          size="small"
          loading={adjustmentLoading}
          columns={adjustmentColumns}
          dataSource={adjustments}
          pagination={{ pageSize: 5 }}
        />
      </Modal>
    </>
  );
}
