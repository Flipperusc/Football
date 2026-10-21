"use client";

import { useState } from "react";
import { Alert, App, Button, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type { Player } from "@/lib/client-types";
import { formalNameConflict, summarizeTrialEvents, type TrialDraft } from "@/lib/trial-players";

type Games = Parameters<typeof summarizeTrialEvents>[1];
export function TrialPlayersPanel({ trials, players, games = [], disabled, onChange, onResolve, onRemove }: {
  trials: TrialDraft[];
  players: Player[];
  games?: Games;
  disabled?: boolean;
  onChange: (trials: TrialDraft[]) => void;
  onResolve: (trialId: string, playerId: string, team: "RED" | "BLUE" | "WHITE") => void;
  onRemove: (trialId: string) => void;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [correcting, setCorrecting] = useState<TrialDraft>();
  const [playerId, setPlayerId] = useState<string>();
  const [team, setTeam] = useState<"RED" | "BLUE" | "WHITE">();
  const pending = trials.filter((trial) => !trial.confirmed).length;
  function warnFormalConflict(name: string) {
    const formal = formalNameConflict(name, players);
    if (!formal) return false;
    message.warning(`“${name}”已匹配正式球员${formal.name}，请使用正式身份；如为同名不同人，请添加能区分的试训姓名。`);
    return true;
  }
  return <section className="section-panel" aria-label="试训球员">
    <div className="toolbar">
      <Typography.Title level={4} style={{ margin: 0 }}>试训球员</Typography.Title>
      <Space wrap>
        <Input aria-label="试训姓名" placeholder="试训姓名" value={name} disabled={disabled}
          style={{ width: 160 }} onChange={(event) => setName(event.target.value)} />
        <Button icon={<Plus size={16} />} disabled={disabled} onClick={() => {
          const trimmed = name.trim();
          if (!trimmed) { message.warning("请填写试训姓名"); return; }
          if (warnFormalConflict(trimmed)) return;
          if (trials.some((trial) => trial.name === trimmed)) { message.warning("该试训名字已存在，请核对原条目"); return; }
          onChange([...trials, { id: crypto.randomUUID(), name: trimmed, confirmed: false }]);
          setName("");
        }}>新增试训球员</Button>
      </Space>
    </div>
    <Typography.Paragraph type="secondary">仅核对本场事件，不计入正式球员的赛季数据和榜单。代表队在对应事件中选择。</Typography.Paragraph>
    {pending > 0 ? <Alert type="warning" showIcon message={`${pending} 名试训球员待确认`}
      description="识别失败或模糊匹配的名字暂列为试训。请确认身份，或纠正为正式球员后再入库。" style={{ marginBottom: 12 }} /> : null}
    <Table rowKey="id" size="small" pagination={false} scroll={{ x: 700 }}
      dataSource={trials.map((trial) => ({ ...trial, ...summarizeTrialEvents(trial.id, games) }))}
      locale={{ emptyText: "暂无试训球员" }} columns={[
        { title: "姓名", dataIndex: "name", render: (value, row) => <Space wrap>{value}<Tag color={row.confirmed ? "blue" : "gold"}>{row.confirmed ? "试训" : "待确认"}</Tag></Space> },
        { title: "进球节次", dataIndex: "goals" },
        { title: "助攻节次", dataIndex: "assists" },
        { title: "乌龙节次", dataIndex: "ownGoals" },
        { title: "操作", render: (_, row) => <Space wrap>
          {!row.confirmed ? <Button size="small" disabled={disabled} onClick={() => {
            if (!warnFormalConflict(row.name)) onChange(trials.map((trial) => trial.id === row.id ? { ...trial, confirmed: true } : trial));
          }}>确认为试训</Button> : null}
          <Button size="small" disabled={disabled} onClick={() => { setCorrecting(row); setPlayerId(undefined); setTeam(undefined); }}>匹配正式球员</Button>
          <Button size="small" danger disabled={disabled} aria-label={`移除试训${row.name}`} icon={<Trash2 size={14} />} onClick={() => onRemove(row.id)} />
        </Space> }
      ]} />
    <Modal title="匹配正式球员" open={!!correcting} okText="确认匹配" cancelText="取消"
      okButtonProps={{ disabled: !playerId || !team || disabled }} onCancel={() => setCorrecting(undefined)}
      onOk={() => { if (correcting && playerId && team) { onResolve(correcting.id, playerId, team); setCorrecting(undefined); } }}>
      <Typography.Paragraph>将“{correcting?.name}”关联到正式球员。已有当天分队的球员保留原队；尚未分队者使用下方选择。</Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select aria-label="匹配正式球员姓名" placeholder="选择正式球员" showSearch optionFilterProp="label" style={{ width: "100%" }}
          value={playerId} onChange={setPlayerId} options={players.map((player) => ({ label: player.name, value: player.id }))} />
        <Select aria-label="正式球员当天原队" placeholder="选择当天原队" style={{ width: "100%" }} value={team} onChange={setTeam}
          options={[{ label: "红队", value: "RED" }, { label: "蓝队", value: "BLUE" }, { label: "白队", value: "WHITE" }]} />
      </Space>
    </Modal>
  </section>;
}
