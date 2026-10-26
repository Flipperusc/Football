"use client";

import { useState } from "react";
import { Alert, App, Button, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { Plus, Trash2 } from "lucide-react";
import type { Player, TrialIdentityChoice } from "@/lib/client-types";
import { TrialIdentityPrompt } from "@/components/TrialIdentityPrompt";
import { formalNameConflict, summarizeTrialEvents, type TrialDraft } from "@/lib/trial-players";

type Games = Parameters<typeof summarizeTrialEvents>[1];
export function TrialPlayersPanel({ trials, players, games = [], disabled, onChange, onResolve, onRemove }: {
  trials: TrialDraft[];
  players: Player[];
  games?: Games;
  disabled?: boolean;
  onChange: (trials: TrialDraft[]) => void;
  onResolve: (trialId: string, choice: TrialIdentityChoice) => Promise<void>;
  onRemove: (trialId: string) => void;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [correcting, setCorrecting] = useState<TrialDraft>();
  const [playerId, setPlayerId] = useState<string>();
  const [promoting, setPromoting] = useState<string>();
  const [processing, setProcessing] = useState(false);
  const [resolutionError, setResolutionError] = useState<string>();
  const blocked = disabled || processing;
  const pending = trials.filter((trial) => !trial.confirmed).length;
  function warnFormalConflict(name: string) {
    const formal = formalNameConflict(name, players);
    if (!formal) return false;
    message.warning(`“${name}”已匹配正式球员${formal.name}，请使用正式身份；如为同名不同人，请添加能区分的试训姓名。`);
    return true;
  }
  function keepTrial(trial: TrialDraft) {
    if (warnFormalConflict(trial.name)) return false;
    onChange(trials.map((row) => row.id === trial.id ? { ...row, confirmed: true } : row));
    return true;
  }
  function matchTrial(trial: TrialDraft) {
    setCorrecting(trial); setPlayerId(formalNameConflict(trial.name, players)?.id); setResolutionError(undefined);
  }
  async function resolve(trial: TrialDraft, choice: TrialIdentityChoice) {
    if (blocked) return;
    setProcessing(true); setResolutionError(undefined);
    try {
      await onResolve(trial.id, choice);
      setCorrecting(undefined); setPromoting(undefined);
      message.success("已关联正式球员，本场数据确认入库后计入个人统计");
    } catch (error) {
      const text = error instanceof Error ? error.message : "身份处理失败，请重试";
      setResolutionError(text); message.error(text);
    } finally { setProcessing(false); }
  }
  return <section className="section-panel" aria-label="试训球员">
    <div className="toolbar">
      <Typography.Title level={4} style={{ margin: 0 }}>试训球员</Typography.Title>
      <Space wrap>
        <Input aria-label="试训姓名" placeholder="试训姓名" value={name} disabled={blocked}
          style={{ width: 160 }} onChange={(event) => setName(event.target.value)} />
        <Button icon={<Plus size={16} />} disabled={blocked} onClick={() => {
          const trimmed = name.trim();
          if (!trimmed) { message.warning("请填写试训姓名"); return; }
          if (warnFormalConflict(trimmed)) return;
          if (trials.some((trial) => trial.name === trimmed)) { message.warning("该试训名字已存在，请核对原条目"); return; }
          onChange([...trials, { id: crypto.randomUUID(), name: trimmed, confirmed: false }]);
          setName("");
        }}>新增试训球员</Button>
      </Space>
    </div>
    <Typography.Paragraph type="secondary">试训仅核对本场事件，不计正式个人数据。可加入正式名单或匹配已有球员；身份处理不会自动加入当天分队。</Typography.Paragraph>
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
          {!row.confirmed ? <Button size="small" disabled={blocked} onClick={() => keepTrial(row)}>确认为试训</Button> : null}
          <Button size="small" disabled={blocked} onClick={() => { setPromoting(row.id); setResolutionError(undefined); }}>加入正式名单</Button>
          <Button size="small" disabled={blocked} onClick={() => matchTrial(row)}>匹配正式球员</Button>
          <Button size="small" danger disabled={blocked} aria-label={`移除试训${row.name}`} icon={<Trash2 size={14} />} onClick={() => onRemove(row.id)} />
        </Space> }
      ]} />
    <TrialIdentityPrompt trials={trials} players={players} games={games} disabled={blocked} matching={!!correcting} requestedId={promoting}
      error={resolutionError} onDismiss={() => { setPromoting(undefined); setResolutionError(undefined); }}
      onCreate={(trial, name) => resolve(trial, { name })} onMatch={matchTrial} onKeep={keepTrial} />
    <Modal title="匹配正式球员" open={!!correcting} okText="确认匹配" cancelText="取消" confirmLoading={processing}
      okButtonProps={{ disabled: !playerId || blocked }} cancelButtonProps={{ disabled: blocked }} closable={!blocked} keyboard={!blocked}
      onCancel={() => setCorrecting(undefined)} onOk={() => { if (correcting && playerId) void resolve(correcting, { playerId }); }}>
      <Typography.Paragraph>将“{correcting?.name}”的本场事件关联到正式球员。已有分队保留原队；未分队者按代打录入，不增加出勤和排名积分。</Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select aria-label="匹配正式球员姓名" placeholder="选择正式球员" showSearch optionFilterProp="label" style={{ width: "100%" }}
          disabled={blocked} value={playerId} onChange={setPlayerId} options={players.map((player) => ({ label: player.name, value: player.id }))} />
        {resolutionError ? <Alert type="error" showIcon message={resolutionError} /> : null}
      </Space>
    </Modal>
  </section>;
}
