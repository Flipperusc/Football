"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Form, Input, Select, Space, Tag } from "antd";
import { Plus, Send, Upload, Wand2, UsersRound } from "lucide-react";
import type { MatchDay, Player, Season } from "@/lib/client-types";
import { getRequestErrorMessage, requestJson } from "@/lib/client-types";
import { useElapsedSeconds } from "@/lib/use-elapsed-seconds";

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

type SubmitPhase = "idle" | "saving" | "parsing";

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

type RosterImageParseResponse = RosterParseResponse & {
  ocrText: string;
};

type RecognizeSource = "text" | "image";

const rosterImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const maxRosterImageBytes = 8 * 1024 * 1024;

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
  const rosterImageInputRef = useRef<HTMLInputElement>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeSource, setRecognizeSource] = useState<RecognizeSource>("text");
  const [editingMatchDayId, setEditingMatchDayId] = useState<string>();
  const [editingConfirmedMatch, setEditingConfirmedMatch] = useState(false);
  const [parseFailed, setParseFailed] = useState(false);
  const [parseError, setParseError] = useState<string>();
  const [aliasPlayerId, setAliasPlayerId] = useState<string>();
  const [aliasText, setAliasText] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const [recognizeWarning, setRecognizeWarning] = useState<string>();
  const [recognizeError, setRecognizeError] = useState<string>();
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
  const submitting = submitPhase !== "idle";
  const parseElapsedSeconds = useElapsedSeconds(submitPhase === "parsing");
  const recognizeElapsedSeconds = useElapsedSeconds(recognizing);

  useEffect(() => {
    async function load() {
      try {
        const editId =
          typeof window === "undefined"
            ? undefined
            : new URLSearchParams(window.location.search).get("edit") ?? undefined;
        const [playerRows, seasonRows, matchRow] = await Promise.all([
          requestJson<Player[]>("/api/players"),
          requestJson<Season[]>("/api/seasons"),
          editId ? requestJson<MatchDay>(`/api/matchdays/${editId}`) : Promise.resolve(null)
        ]);
        setPlayers(playerRows);
        setSeasons(seasonRows);

        if (!matchRow) {
          form.setFieldsValue({
            date: todayInput(),
            seasonId: seasonRows.find((season) => season.status === "ACTIVE")?.id ?? seasonRows[0]?.id
          });
          return;
        }

        if (matchRow.type !== type) throw new Error("比赛类型与当前录入页面不一致");
        setEditingConfirmedMatch(matchRow.parseStatus === "CONFIRMED");
        setParseFailed(matchRow.parseStatus === "FAILED");

        setEditingMatchDayId(matchRow.id);
        form.setFieldsValue({
          seasonId: matchRow.seasonId,
          date: matchRow.date.slice(0, 10),
          rawText: matchRow.rawText ?? ""
        });

        if (type === "INTERNAL") {
          const nextTeamPlayers: Record<InternalTeamColor, string[]> = { RED: [], BLUE: [], WHITE: [] };
          const nextGoalkeepers: Record<InternalTeamColor, string | undefined> = {
            RED: undefined,
            BLUE: undefined,
            WHITE: undefined
          };
          for (const assignment of matchRow.assignments ?? []) {
            if (!isInternalTeam(assignment.teamColor)) continue;
            if (assignment.role === "GOALKEEPER") nextGoalkeepers[assignment.teamColor] = assignment.playerId;
            else nextTeamPlayers[assignment.teamColor].push(assignment.playerId);
          }
          setTeamPlayers(nextTeamPlayers);
          setGoalkeepers(nextGoalkeepers);
        } else {
          form.setFieldValue(
            "externalPlayers",
            (matchRow.assignments ?? []).map((assignment) => assignment.playerId)
          );
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : "加载基础数据失败");
      }
    }
    void load();
  }, [form, message, type]);

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

  async function parseRosterImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    return requestJson<RosterImageParseResponse>("/api/roster/parse-image", {
      method: "POST",
      body: formData
    });
  }

  async function addAlias() {
    const alias = aliasText.trim();
    if (!aliasPlayerId || !alias) {
      message.warning("请选择球员并填写别名");
      return;
    }

    setAliasSaving(true);
    try {
      const savedAlias = await requestJson<{ id: string; alias: string; aliasType: string }>(
        `/api/players/${aliasPlayerId}/aliases`,
        {
          method: "POST",
          body: JSON.stringify({ alias, aliasType: "MANUAL" })
        }
      );
      setPlayers((current) =>
        current.map((player) =>
          player.id === aliasPlayerId
            ? { ...player, aliases: [...(player.aliases ?? []), savedAlias] }
            : player
        )
      );
      setAliasText("");
      message.success("别名已保存，可立即重新识别球队名单");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存别名失败");
    } finally {
      setAliasSaving(false);
    }
  }

  function applyInternalRosterResult(result: RosterParseResponse, sourceLabel: string) {
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
    const recognizedPlayerIds = new Set<string>();

    for (const row of result.parsed.assignments) {
      if (
        !row.playerId ||
        !isInternalTeam(row.teamColor) ||
        recognizedPlayerIds.has(row.playerId)
      ) {
        continue;
      }
      recognizedPlayerIds.add(row.playerId);
      if (row.role === "GOALKEEPER") {
        nextGoalkeepers[row.teamColor] = row.playerId;
      } else {
        nextTeamPlayers[row.teamColor].push(row.playerId);
      }
    }

    setTeamPlayers((current) => ({
      RED: unique([
        ...current.RED.filter((id) => !recognizedPlayerIds.has(id)),
        ...nextTeamPlayers.RED
      ]),
      BLUE: unique([
        ...current.BLUE.filter((id) => !recognizedPlayerIds.has(id)),
        ...nextTeamPlayers.BLUE
      ]),
      WHITE: unique([
        ...current.WHITE.filter((id) => !recognizedPlayerIds.has(id)),
        ...nextTeamPlayers.WHITE
      ])
    }));
    setGoalkeepers((current) => ({
      RED: nextGoalkeepers.RED ??
        (current.RED && !recognizedPlayerIds.has(current.RED) ? current.RED : undefined),
      BLUE: nextGoalkeepers.BLUE ??
        (current.BLUE && !recognizedPlayerIds.has(current.BLUE) ? current.BLUE : undefined),
      WHITE: nextGoalkeepers.WHITE ??
        (current.WHITE && !recognizedPlayerIds.has(current.WHITE) ? current.WHITE : undefined)
    }));

    const uncertainCount = result.parsed.uncertainItems.length;
    if (uncertainCount > 0) {
      setRecognizeWarning(`有 ${uncertainCount} 项没有高置信度匹配，请检查球员名单和别名。`);
    }
    message.success(`${sourceLabel} 已识别 ${recognizedPlayerIds.size} 名球员`);
  }

  async function recognizeInternalRoster() {
    if (!rosterText.trim()) {
      message.warning("请先粘贴分队名单");
      return;
    }

    setRecognizing(true);
    setRecognizeSource("text");
    setRecognizeWarning(undefined);
    setRecognizeError(undefined);
    try {
      const result = await parseRoster(rosterText, "INTERNAL");
      applyInternalRosterResult(result, result.usedFallback ? "本地规则" : "DeepSeek");
    } catch (error) {
      const errorMessage = getRequestErrorMessage(error, "识别阵容失败");
      setRecognizeError(errorMessage);
      message.error(errorMessage);
    } finally {
      setRecognizing(false);
    }
  }

  async function recognizeInternalRosterImage(file: File) {
    if (file.type && !rosterImageTypes.has(file.type)) {
      message.warning("仅支持 JPG、PNG、WEBP、GIF 分队图片");
      return;
    }
    if (file.size > maxRosterImageBytes) {
      message.warning("分队图片不能超过 8MB");
      return;
    }

    setRecognizing(true);
    setRecognizeSource("image");
    setRecognizeWarning(undefined);
    setRecognizeError(undefined);
    try {
      const result = await parseRosterImage(file);
      setRosterText(result.ocrText);
      applyInternalRosterResult(result, "DeepSeek Flash OCR");
    } catch (error) {
      const errorMessage = getRequestErrorMessage(error, "识别分队图片失败");
      setRecognizeError(errorMessage);
      message.error(errorMessage);
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
    setRecognizeSource("text");
    setRecognizeWarning(undefined);
    setRecognizeError(undefined);
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
      const errorMessage = getRequestErrorMessage(error, "识别出勤名单失败");
      setRecognizeError(errorMessage);
      message.error(errorMessage);
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
    const wasEditing = Boolean(editingMatchDayId);
    let savedMatchDayId = editingMatchDayId;
    let parseStarted = false;
    setSubmitPhase("saving");
    setParseError(undefined);
    try {
      const matchDay = editingMatchDayId
        ? await requestJson<{ id: string }>(`/api/matchdays/${editingMatchDayId}`, {
            method: "PATCH",
            body: JSON.stringify({
              seasonId: values.seasonId,
              date: values.date,
              rawText: values.rawText,
              parseStatus: "PENDING",
              assignments
            })
          })
        : await requestJson<{ id: string }>("/api/matchdays", {
            method: "POST",
            body: JSON.stringify({
              seasonId: values.seasonId,
              date: values.date,
              type,
              rawText: values.rawText,
              assignments
            })
          });

      savedMatchDayId = matchDay.id;
      setEditingMatchDayId(matchDay.id);
      setEditingConfirmedMatch(false);
      setParseFailed(false);
      if (!editingMatchDayId) {
        const entryPath = type === "INTERNAL" ? "/matchdays/internal" : "/matchdays/external";
        router.replace(`${entryPath}?edit=${matchDay.id}`);
      }

      parseStarted = true;
      setSubmitPhase("parsing");
      await requestJson(`/api/matchdays/${matchDay.id}/parse`, {
        method: "POST",
        body: JSON.stringify({
          rawText: values.rawText,
          matchType: type,
          teamAssignments: assignments
        })
      });

      setParseFailed(false);
      setParseError(undefined);
      message.success(wasEditing ? "重新解析完成，请确认结果" : "解析完成，请确认结果");
      router.push(`/matchdays/${matchDay.id}/confirm`);
    } catch (error) {
      const errorMessage = getRequestErrorMessage(error, parseStarted ? "解析比赛失败" : "保存比赛失败");
      if (parseStarted && savedMatchDayId) {
        setEditingMatchDayId(savedMatchDayId);
        setParseFailed(true);
        setParseError(errorMessage);
      }
      message.error(errorMessage);
    } finally {
      setSubmitPhase("idle");
    }
  }

  const quickAliasPanel = (
    <div className="team-band">
      <div style={{ marginBottom: 10 }}>
        <strong>快速新增球员别名</strong>
        <div style={{ color: "#64748b", marginTop: 4 }}>
          保存后可直接重新点击上方识别按钮，无需进入球员管理页。
        </div>
      </div>
      <Space.Compact style={{ width: "100%" }}>
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 240 }}
          placeholder="选择球员"
          value={aliasPlayerId}
          options={playerOptions}
          onChange={setAliasPlayerId}
        />
        <Input
          placeholder="输入昵称、简称或常见错别字"
          value={aliasText}
          onChange={(event) => setAliasText(event.target.value)}
          onPressEnter={addAlias}
        />
        <Button icon={<Plus size={16} />} onClick={addAlias} loading={aliasSaving}>
          保存别名
        </Button>
      </Space.Compact>
    </div>
  );

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

      {recognizing ? (
        <Alert
          type="info"
          showIcon
          message={`${
            recognizeSource === "image" ? "DeepSeek Flash 正在 OCR 分队照片" : "DeepSeek 正在识别名单"
          }，已等待 ${recognizeElapsedSeconds} 秒，最长约 90 秒，请勿重复点击`}
          description={
            recognizeElapsedSeconds >= 45
              ? "首次尝试时间较长，系统可能正在重试。请继续等待当前请求返回。"
              : recognizeSource === "image"
                ? "OCR 完成后会回填可编辑文本，并自动填入红、蓝、白队阵容。"
                : "识别完成后会自动填入名单。"
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {recognizeError ? (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setRecognizeError(undefined)}
          message="名单识别未完成"
          description={recognizeError}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {recognizeWarning ? (
        <Alert type="warning" showIcon message={recognizeWarning} style={{ marginBottom: 12 }} />
      ) : null}

      {editingMatchDayId ? (
        <Alert
          type={editingConfirmedMatch ? "warning" : "info"}
          showIcon
          message={editingConfirmedMatch ? "正在修改已入库的比赛" : "正在修改已解析的比赛日"}
          description={
            editingConfirmedMatch
              ? "保存后会重新解析；确认入库时将覆盖这场比赛原有的比分、进球、助攻、积分和奖项，不会重复累计。"
              : "保存后会更新当前比赛日并生成新的解析结果，不会创建重复记录。"
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {type === "INTERNAL" ? (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <div className="team-band">
            <Form.Item label="粘贴分队名单，或上传分队照片">
              <Input.TextArea
                rows={8}
                value={rosterText}
                onChange={(event) => setRosterText(event.target.value)}
                placeholder={"红\n果之林\n欧巴\n十三\n...\n10\n小王\n蓝\n肖老师\n...\n白\n游老师\n..."}
              />
            </Form.Item>
            <Space wrap>
              <Button
                icon={<UsersRound size={16} />}
                onClick={recognizeInternalRoster}
                loading={recognizing && recognizeSource === "text"}
                disabled={submitting || recognizing}
              >
                DeepSeek 识别文本并填入阵容
              </Button>
              <Button
                icon={<Upload size={16} />}
                onClick={() => rosterImageInputRef.current?.click()}
                loading={recognizing && recognizeSource === "image"}
                disabled={submitting || recognizing}
              >
                上传分队照片识别
              </Button>
              <input
                ref={rosterImageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                aria-label="选择分队照片"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void recognizeInternalRosterImage(file);
                }}
              />
            </Space>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              支持 JPG、PNG、WEBP、GIF，最大 8MB。图片会发送给 DeepSeek 做本次 OCR，本系统不会保存。
            </p>
          </div>

          {quickAliasPanel}

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
              disabled={submitting || recognizing}
            >
              DeepSeek 识别出勤名单
            </Button>
          </div>
          {quickAliasPanel}
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

      {submitPhase === "saving" ? (
        <Alert
          type="info"
          showIcon
          message="正在保存比赛信息"
          description="保存完成后会自动开始 DeepSeek 解析。"
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {submitPhase === "parsing" ? (
        <Alert
          type="info"
          showIcon
          message={`比赛已保存，DeepSeek 正在解析，已等待 ${parseElapsedSeconds} 秒，最长约 90 秒，请勿重复提交`}
          description={
            parseElapsedSeconds >= 45
              ? "首次尝试时间较长，系统可能正在重试。请继续等待当前请求返回。"
              : "解析完成后会自动进入确认页面。"
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {parseError ? (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setParseError(undefined)}
          message="解析未完成，比赛信息已保存"
          description={`${parseError} 当前页面已经绑定到同一场比赛，再次点击“重新解析”不会创建重复比赛。`}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Button
        type="primary"
        htmlType="submit"
        icon={<Wand2 size={16} />}
        loading={submitting}
        disabled={submitting || recognizing}
      >
        {submitPhase === "saving"
          ? "正在保存比赛信息"
          : submitPhase === "parsing"
            ? `DeepSeek 解析中（${parseElapsedSeconds} 秒）`
            : parseFailed
              ? "重新解析"
              : editingMatchDayId
                ? "保存修改并重新解析"
                : "保存并解析"}
      </Button>
      <Button
        style={{ marginLeft: 8 }}
        icon={<Send size={16} />}
        onClick={() => form.submit()}
        loading={submitting}
        disabled={submitting || recognizing}
      >
        {parseFailed ? "重新解析并进入确认" : "进入确认"}
      </Button>
    </Form>
  );
}
