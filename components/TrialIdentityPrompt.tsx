"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Space, Typography } from "antd";
import type { Player } from "@/lib/client-types";
import { formalNameConflict, summarizeTrialEvents, type TrialDraft } from "@/lib/trial-players";

export function TrialIdentityPrompt({ trials, players, games, disabled, matching, requestedId, error, onDismiss, onCreate, onMatch, onKeep }: {
  trials: TrialDraft[]; players: Player[]; games: Parameters<typeof summarizeTrialEvents>[1];
  disabled?: boolean; matching: boolean; requestedId?: string; error?: string;
  onDismiss: () => void; onCreate: (trial: TrialDraft, name: string) => Promise<void>;
  onMatch: (trial: TrialDraft) => void; onKeep: (trial: TrialDraft) => boolean;
}) {
  const seen = useRef(new Set<string>());
  const [ids, setIds] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (disabled) return;
    const fresh = trials.filter((row) => !row.confirmed && !seen.current.has(`${row.id}:${row.name}`));
    fresh.forEach((row) => seen.current.add(`${row.id}:${row.name}`));
    if (fresh.length) setIds((current) => [...new Set([...current, ...fresh.map((row) => row.id)])]);
  }, [trials, disabled]);
  const rows = trials.filter((row) => ids.includes(row.id) || row.id === requestedId);
  function dismiss() { if (!disabled) { setIds([]); onDismiss(); } }
  return <Modal title="发现未加入正式名单的球员" width={680} open={rows.length > 0 && !matching}
    closable={!disabled} maskClosable={false} keyboard={!disabled} onCancel={dismiss}
    footer={<Button disabled={disabled} onClick={dismiss}>稍后处理</Button>}>
    <Typography.Paragraph>请核对姓名。加入正式名单立即生效，本场进球和助攻确认入库后计入个人统计；未加入当天分队者不增加出勤和排名积分。也可以保留试训身份。</Typography.Paragraph>
    <Space direction="vertical" size="large" style={{ width: "100%", maxHeight: "55vh", overflowY: "auto" }}>
      {rows.map((trial) => {
        const name = names[trial.id] ?? trial.name;
        const conflict = formalNameConflict(name, players);
        const summary = summarizeTrialEvents(trial.id, games);
        return <section key={trial.id} aria-label={`处理身份${trial.name}`}>
          <Typography.Text strong>原始姓名：{trial.name}</Typography.Text>
          <Typography.Paragraph type="secondary">进球：{summary.goals}　助攻：{summary.assists}　乌龙：{summary.ownGoals}</Typography.Paragraph>
          <Input aria-label={`正式姓名${trial.name}`} maxLength={100} value={name} disabled={disabled}
            onChange={(event) => setNames((current) => ({ ...current, [trial.id]: event.target.value }))} />
          {conflict ? <Typography.Paragraph type="warning">姓名或别名已属于 {conflict.name}，请核对后匹配已有球员。</Typography.Paragraph> : null}
          <Space wrap style={{ marginTop: 8 }}>
            <Button type="primary" disabled={disabled || !name.trim() || !!conflict} onClick={() => void onCreate(trial, name.trim())}>加入正式名单</Button>
            <Button disabled={disabled} onClick={() => onMatch(trial)}>匹配已有球员</Button>
            <Button disabled={disabled} onClick={() => { if (onKeep(trial)) { setIds((current) => current.filter((id) => id !== trial.id)); if (requestedId === trial.id) onDismiss(); } }}>保留试训</Button>
          </Space>
        </section>;
      })}
    </Space>
    {error ? <Alert type="error" showIcon message={error} style={{ marginTop: 16 }} /> : null}
  </Modal>;
}
