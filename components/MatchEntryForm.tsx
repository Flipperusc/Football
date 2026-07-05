"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Form, Input, Select, Space, Tag } from "antd";
import { Send, Wand2, UsersRound } from "lucide-react";
import type { Player, Season } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

type TeamColor = "RED" | "BLUE" | "WHITE" | "EXTERNAL";
type InternalTeamColor = Exclude<TeamColor, "EXTERNAL">;

type Assignment = {
  teamColor: TeamColor;
  playerId: string;
  role: "PLAYER" | "GOALKEEPER";
  isCaptain: boolean;
};

type FormValues = {
  seasonId: string;
  date: string;
  rawText: string;
  externalPlayers?: string[];
};

type RosterParseResponse = {
  parsed: {
    assignments: {
      teamColor: TeamColor;
      role: "PLAYER" | "GOALKEEPER";
      rawName: string;
      playerId: string | null;
      matchedName?: string | null;
      confidence: number;
      needsReview: boolean;
    }[];
    uncertainItems: { rawText: string; reason: string }[];
  };
  modelName: string;
  usedFallback: boolean;
};

const teamLabels: Record<InternalTeamColor, string> = {
  RED: "红队",
  BLUE: "蓝队",
  WHITE: "白队"
};

const teamTagColors: Record<InternalTeamColor, string> = {
  RED: "red",
  BLUE: "blue",
  WHITE: "default"
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function isInternalTeam(teamColor: TeamColor): teamColor is InternalTeamColor {
  return teamColor === "RED" || teamColor === "BLUE" || teamColor === "WHITE";
}

export function MatchEntryForm({ type }: { type: "INTERNAL" | "EXTERNAL" }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<FormValues>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeWarning, setRecognizeWarning] = useState<string>();
  const [rosterText, setRosterText] = useState("");
  const [externalRosterText, setExternalRosterText] = useState("");
  const [teamPlayers, setTeamPlayers] = useState<Record<InternalTeamColor, string[]>>({
    RED: [],
    BLUE: [],
    WHITE: []
  });
  const [goalkeepers, setGoalkeepers] = useState<Record<InternalTeamColor, string | undefined>>({
    RED: undefined,
    BLUE: undefined,
    WHITE: undefined
  });

  useEffect(() => {
    async function load() {
      try {
        const [playerRows, seasonRows] = await Promise.all([
          requestJson<Player[]>("/api/players"),
          requestJson<Season[]>("/api/seasons")
        ]);
        setPlayers(playerRows);
        setSeasons(seasonRows);
        form.setFieldsValue({
          date: todayInput(),
          seasonId: seasonRows.find((season) => season.status === "ACTIVE")?.id ?? seasonRows[0]?.id
        });
      } catch (error) {
        message.error(error instanceof Error ? error.message : "加载基础数据失败");
      }
    }
    void load();
  }, [form, message]);

  const playerOptions = useMemo(
    () => players.map((player) => ({ label: player.name, value: player.id })),
    [players]
  );

  function internalAssignments() {
    return (["RED", "BLUE", "WHITE"] as const).flatMap((teamColor) => {
      const keeper = goalkeepers[teamColor];
      const rows: Assignment[] = teamPlayers[teamColor]
        .filter((playerId) => playerId !== keeper)
        .map((playerId) => ({
          teamColor,
          playerId,
          role: "PLAYER",
          isCaptain: false
        }));
      if (keeper) {
        rows.push({
          teamColor,
          playerId: keeper,
          role: "GOALKEEPER",
          isCaptain: false
        });
      }
      return rows;
    });
  }

  function externalAssignments(values: FormValues) {
    return (values.externalPlayers ?? []).map((playerId) => ({
      teamColor: "EXTERNAL" as const,
      playerId,
      role: "PLAYER" as const,
      isCaptain: false
    }));
  }

  async function parseRoster(rawText: string, matchType: "INTERNAL" | "EXTERNAL") {
    return requestJson<RosterParseResponse>("/api/roster/parse", {
      method: "POST",
      body: JSON.stringify({ rawText, matchType })
    });
  }

  async function recognizeInternalRoster() {
    if (!rosterText.trim()) {
      message.warning("请先粘贴分队名单");
      return;
    }

    setRecognizing(true);
    setRecognizeWarning(undefined);
    try {
      const result = await parseRoster(rosterText, "INTERNAL");
      const nextTeamPlayers: Record<InternalTeamColor, string[]> = {
        RED: [],
        BLUE: [],
        WHITE: []
      };
      const nextGoalkeepers: Record<InternalTeamColor, string | undefined> = {
        RED: undefined,
        BLUE: undefined,
        WHITE: undefined
      };

      for (const row of result.parsed.assignments) {
        if (!row.playerId || !isInternalTeam(row.teamColor)) continue;
        if (row.role === "GOALKEEPER") {
          nextGoalkeepers[row.teamColor] = row.playerId;
        } else {
          nextTeamPlayers[row.teamColor].push(row.playerId);
        }
      }

      setTeamPlayers((current) => ({
        RED: unique([...current.RED, ...nextTeamPlayers.RED]),
        BLUE: unique([...current.BLUE, ...nextTeamPlayers.BLUE]),
        WHITE: unique([...current.WHITE, ...nextTeamPlayers.WHITE])
      }));
      setGoalkeepers((current) => ({
        RED: nextGoalkeepers.RED ?? current.RED,
        BLUE: nextGoalkeepers.BLUE ?? current.BLUE,
        WHITE: nextGoalkeepers.WHITE ?? current.WHITE
      }));

      const count = result.parsed.assignments.filter((row) => row.playerId).length;
      const uncertainCount = result.parsed.uncertainItems.length;
      if (uncertainCount > 0) {
        setRecognizeWarning(`有 ${uncertainCount} 项没有高置信度匹配，请检查球员名单和别名。`);
      }
      message.success(`${result.usedFallback ? "本地规则" : "DeepSeek"} 已识别 ${count} 名球员`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "识别阵容失败");
    } finally {
      setRecognizing(false);
    }
  }

  async function recognizeExternalRoster() {
    if (!externalRosterText.trim()) {
      message.warning("请先粘贴出勤名单");
      return;
    }

    setRecognizing(true);
    setRecognizeWarning(undefined);
    try {
      const result = await parseRoster(externalRosterText, "EXTERNAL");
      const ids = result.parsed.assignments
        .filter((row) => row.playerId)
        .map((row) => row.playerId!);
      form.setFieldValue("externalPlayers", unique([...(form.getFieldValue("externalPlayers") ?? []), ...ids]));

      const uncertainCount = result.parsed.uncertainItems.length;
      if (uncertainCount > 0) {
        setRecognizeWarning(`有 ${uncertainCount} 项没有高置信度匹配，请检查球员名单和别名。`);
      }
      message.success(`${result.usedFallback ? "本地规则" : "DeepSeek"} 已识别 ${ids.length} 名出勤球员`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "识别出勤名单失败");
    } finally {
      setRecognizing(false);
    }
  }

  async function submit(values: FormValues) {
    const assignments = type === "INTERNAL" ? internalAssignments() : externalAssignments(values);
    if (type === "INTERNAL" && assignments.length === 0) {
      message.error("请先填写红队、蓝队、白队球员，否则无法给球员分配第一名/第二名/第三名积分");
      return;
    }
    setSubmitting(true);
    try {
      const matchDay = await requestJson<{ id: string }>("/api/matchdays", {
        method: "POST",
        body: JSON.stringify({
          seasonId: values.seasonId,
          date: values.date,
          type,
          rawText: values.rawText,
          assignments
        })
      });

      await requestJson(`/api/matchdays/${matchDay.id}/parse`, {
        method: "POST",
        body: JSON.stringify({
          rawText: values.rawText,
          matchType: type,
          teamAssignments: assignments
        })
      });

      message.success("解析完成，请确认结果");
      router.push(`/matchdays/${matchDay.id}/confirm`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Form form={form} layout="vertical" onFinish={submit}>
      <div className="form-grid">
        <Form.Item name="seasonId" label="赛季" rules={[{ required: true }]}>
          <Select
            placeholder="选择赛季"
            options={seasons.map((season) => ({ label: season.name, value: season.id }))}
          />
        </Form.Item>
        <Form.Item name="date" label="日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
      </div>

      {recognizeWarning ? (
        <Alert type="warning" showIcon message={recognizeWarning} style={{ marginBottom: 12 }} />
      ) : null}

      {type === "INTERNAL" ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="team-band">
            <Form.Item label="粘贴分队名单">
              <Input.TextArea
                rows={8}
                value={rosterText}
                onChange={(event) => setRosterText(event.target.value)}
                placeholder={"红\n果之林\n欧巴\n十三\n...\n10\n小王\n蓝\n肖老师\n...\n白\n游老师\n..."}
              />
            </Form.Item>
            <Button
              icon={<UsersRound size={16} />}
              onClick={recognizeInternalRoster}
              loading={recognizing}
            >
              DeepSeek 识别并填入阵容
            </Button>
          </div>

          {(["RED", "BLUE", "WHITE"] as const).map((teamColor) => (
            <div className="team-band" key={teamColor}>
              <Tag color={teamTagColors[teamColor]}>{teamLabels[teamColor]}</Tag>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div>
                  <label>普通球员</label>
                  <Select
                    mode="multiple"
                    showSearch
                    optionFilterProp="label"
                    style={{ width: "100%", marginTop: 6 }}
                    options={playerOptions}
                    value={teamPlayers[teamColor]}
                    onChange={(value) =>
                      setTeamPlayers((current) => ({ ...current, [teamColor]: value }))
                    }
                    placeholder="选择球员"
                  />
                </div>
                <div>
                  <label>门将</label>
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    style={{ width: "100%", marginTop: 6 }}
                    options={playerOptions}
                    value={goalkeepers[teamColor]}
                    onChange={(value) =>
                      setGoalkeepers((current) => ({ ...current, [teamColor]: value }))
                    }
                    placeholder="选择门将"
                  />
                </div>
              </div>
            </div>
          ))}
        </Space>
      ) : (
        <>
          <div className="team-band">
            <Form.Item label="粘贴出勤名单">
              <Input.TextArea
                rows={4}
                value={externalRosterText}
                onChange={(event) => setExternalRosterText(event.target.value)}
                placeholder="粘贴队外赛出勤球员姓名、昵称或别名"
              />
            </Form.Item>
            <Button
              icon={<UsersRound size={16} />}
              onClick={recognizeExternalRoster}
              loading={recognizing}
            >
              DeepSeek 识别出勤名单
            </Button>
          </div>
          <Form.Item name="externalPlayers" label="出勤名单" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              options={playerOptions}
              placeholder="选择队外赛出勤球员"
            />
          </Form.Item>
        </>
      )}

      <Form.Item name="rawText" label="赛后文本" rules={[{ required: true }]} style={{ marginTop: 16 }}>
        <Input.TextArea rows={9} placeholder="粘贴赛后文本" />
      </Form.Item>

      <Button type="primary" htmlType="submit" icon={<Wand2 size={16} />} loading={submitting}>
        保存并解析
      </Button>
      <Button
        style={{ marginLeft: 8 }}
        icon={<Send size={16} />}
        onClick={() => form.submit()}
        loading={submitting}
      >
        进入确认
      </Button>
    </Form>
  );
}
