"use client";

import { Alert, Divider, Modal, Select, Space, Tag, Typography } from "antd";
import { internalTeamLabels, type EventException, type InternalTeam } from "@/lib/match-events";

export function MatchEventConfirmationModal({ open, exceptions, issues, saving, error, trialNames = [], onTeamChange, onConfirm, onCancel }: {
  open: boolean;
  exceptions: EventException[];
  issues: string[];
  saving: boolean;
  error?: string;
  trialNames?: string[];
  onTeamChange: (event: EventException, team: InternalTeam) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title="特殊比赛事件确认" open={open} width={640} maskClosable={false}
      okText="确认特殊事件并继续" cancelText="返回修改" confirmLoading={saving}
      okButtonProps={{ disabled: issues.length > 0 || exceptions.some((event) => !event.team) }}
      cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving}
      onOk={onConfirm} onCancel={onCancel}>
      <Alert type="info" showIcon message="请核对试训身份和特殊事件"
        description="临时未到场者仍正常计算出勤；正式球员按原队排名计分。代打者只算一次出勤，试训人员不计正式个人数据。" />
      <Typography.Paragraph style={{ marginTop: 12 }}><strong>试训球员：</strong>{trialNames.join("、") || "无"}</Typography.Paragraph>
      <div style={{ maxHeight: "55vh", overflowY: "auto", paddingInlineEnd: 8, marginTop: 16 }}>
        {exceptions.map((event, index) => (
          <section key={event.key} aria-label={`第${event.sectionNo}节特殊事件${event.eventIndex + 1}`} style={{ overflowWrap: "anywhere" }}>
            {index > 0 ? <Divider style={{ marginBlock: 16 }} /> : null}
            <Space wrap size={8}>
              <Typography.Text strong>第 {event.sectionNo} 节 · {internalTeamLabels[event.teamA]} vs {internalTeamLabels[event.teamB]}</Typography.Text>
              <Tag color={event.type === "own_goal" ? "orange" : "blue"}>{event.type === "own_goal" ? "乌龙球" : !event.scorerTeam || (event.assistName && !event.assistTeam) ? "试训事件" : "临时代打"}</Tag>
            </Space>
            <Typography.Paragraph style={{ marginBlock: 12 }}>
              {event.scorerName}（{event.scorerTeam ? `当天属于${internalTeamLabels[event.scorerTeam]}` : "试训"}）
              {event.representedTeam ? `本次代表${internalTeamLabels[event.representedTeam]}` : "，请确认本次得分队"}
              {event.type === "own_goal" ? `发生 ${event.count} 次乌龙球。` : `进球 ${event.count} 个。`}
            </Typography.Paragraph>
            {event.assistName ? (
              <Typography.Paragraph>
                助攻：{event.assistName}（{event.assistTeam ? `当天属于${internalTeamLabels[event.assistTeam]}` : "试训"}）
                {event.team ? `，本次代表${internalTeamLabels[event.team]}${event.assistTeam ? `，个人助攻 +${event.count}` : "，不计正式个人助攻"}。` : "，请确认得分队。"}
              </Typography.Paragraph>
            ) : null}
            <Space wrap>
              <Typography.Text>得分计入</Typography.Text>
              <Select aria-label={`确认第${event.sectionNo}节事件${event.eventIndex + 1}得分队`} style={{ minWidth: 120 }}
                value={event.team} placeholder="选择得分队" disabled={saving} status={!event.team ? "error" : undefined}
                options={[event.teamA, event.teamB].map((team) => ({ label: internalTeamLabels[team], value: team }))}
                onChange={(team) => onTeamChange(event, team)} />
            </Space>
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              {event.type === "own_goal" ? "乌龙球不计个人进球和助攻" : event.scorerTeam ? `${event.scorerName}个人进球 +${event.count}` : "试训进球只计团队比分，不计正式个人数据"}
            </Typography.Paragraph>
          </section>
        ))}
      </div>
      {issues.length ? <Alert type="error" showIcon style={{ marginTop: 16 }} message="请返回修改后再确认" description={issues.join("；")} /> : null}
      {error ? <Alert type="error" showIcon style={{ marginTop: 16 }} message={error} /> : null}
    </Modal>
  );
}
