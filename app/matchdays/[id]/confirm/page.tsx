"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import type { MatchDay, Player, TrialIdentityChoice, TrialResolutionResponse } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";
import { defaultEventTeam, inspectInternalEvents, type EventException } from "@/lib/match-events";
import { MatchEventConfirmationModal } from "@/components/MatchEventConfirmationModal";
import { TrialPlayersPanel } from "@/components/TrialPlayersPanel";
import { assignAutomaticTrials } from "@/lib/ai/automatic-trials";
import { resolveTrialReferences, type TrialDraft } from "@/lib/trial-players";

type AiTeamColor = "red" | "blue" | "white" | "external";

type PlayerRef = {
  rawName: string;
  playerId: string | null;
  trialPlayerId?: string | null;
  matchedName?: string | null;
  confidence: number;
  candidates?: { playerId: string; name: string; confidence: number }[];
};

type ParsedEvent = {
  type: "goal" | "own_goal";
  rawText: string;
  team?: AiTeamColor;
  needsTeamSelection?: boolean;
  scorer: PlayerRef;
  assist?: PlayerRef | null;
  count: number;
  confidence: number;
  needsReview: boolean;
};

type ParsedGame = {
  sectionNo: number;
  teamA: Exclude<AiTeamColor, "external">;
  teamB: Exclude<AiTeamColor, "external">;
  scoreA: number;
  scoreB: number;
  rawText: string;
  events: ParsedEvent[];
};

type BonusPoint = {
  player: PlayerRef;
  points: number;
  reason: string;
  rawText: string;
};

type ParsedAward = {
  name: string;
  players: PlayerRef[];
  points: number;
  rawText: string;
};

type AwardRow = {
  key: string;
  awardIndex: number;
  playerIndex: number;
  award: ParsedAward;
  player: PlayerRef;
};

type ParsedMatch = {
  matchType: "internal" | "external";
  games?: ParsedGame[];
  events?: ParsedEvent[];
  awards?: ParsedAward[];
  bonusPoints?: BonusPoint[];
  uncertainItems?: { rawText: string; reason: string }[];
};

type EventRow = ParsedEvent & {
  key: string;
  gameIndex?: number;
  eventIndex: number;
  sectionNo?: number;
};

type AliasDraft = {
  playerId: string;
  rawName: string;
  aliasType: "MANUAL" | "NICKNAME" | "TYPO" | "SHORT_NAME";
};

type InternalTeamColor = "RED" | "BLUE" | "WHITE";

type TeamRankingPreview = {
  teamColor: InternalTeamColor;
  matchPoints: number;
  goalDifference: number;
  rank: number | null;
};

type ManualTeamRank = {
  teamColor: InternalTeamColor;
  rank: number;
};

const teamOptions = [
  { label: "红队", value: "red" },
  { label: "蓝队", value: "blue" },
  { label: "白队", value: "white" },
  { label: "队外", value: "external" }
];

const teamLabels: Record<AiTeamColor, string> = {
  red: "红队",
  blue: "蓝队",
  white: "白队",
  external: "队外"
};

const internalTeamLabels: Record<InternalTeamColor, string> = {
  RED: "红队",
  BLUE: "蓝队",
  WHITE: "白队"
};

function cloneParsed(parsed: ParsedMatch) {
  return JSON.parse(JSON.stringify(parsed)) as ParsedMatch;
}

function assignedTeamForPlayer(matchDay: MatchDay, playerId: string | null | undefined) {
  if (!playerId) return undefined;
  const teamColor = matchDay.assignments?.find((assignment) => assignment.playerId === playerId)?.teamColor;
  if (teamColor === "RED") return "red";
  if (teamColor === "BLUE") return "blue";
  if (teamColor === "WHITE") return "white";
  return undefined;
}

function restoreEventTeams(parsed: ParsedMatch, matchDay: MatchDay) {
  const next = cloneParsed(parsed);
  if (next.matchType !== "internal") return next;
  for (const game of next.games ?? []) {
    for (const event of game.events) {
      if (event.team && event.team !== game.teamA && event.team !== game.teamB) event.team = undefined;
      if (!event.team && !event.needsTeamSelection) event.team = defaultEventTeam(event, game, matchDay.assignments ?? []);
    }
  }
  return next;
}

function playerRefFromId(playerId: string | null | undefined, players: Player[], rawName?: string): PlayerRef {
  if (!playerId) {
    return {
      rawName: rawName ?? "",
      playerId: null,
      matchedName: null,
      confidence: 0,
      candidates: []
    };
  }

  const player = players.find((item) => item.id === playerId);
  return {
    rawName: rawName ?? player?.name ?? "",
    playerId,
    matchedName: player?.name ?? rawName ?? "",
    confidence: 1,
    candidates: []
  };
}

function emptyEvent(team?: AiTeamColor): ParsedEvent {
  return {
    type: "goal",
    team,
    scorer: playerRefFromId(null, []),
    assist: null,
    count: 1,
    rawText: "",
    confidence: 1,
    needsReview: true
  };
}

export default function ConfirmMatchDayPage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [matchDay, setMatchDay] = useState<MatchDay | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [parsed, setParsed] = useState<ParsedMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [pendingEventConfirmation, setPendingEventConfirmation] = useState<{ confirmationToken?: string } | null>(null);
  const [eventConfirmationToken, setEventConfirmationToken] = useState<string>();
  const [confirmationError, setConfirmationError] = useState<string>();
  const [pendingTeamResults, setPendingTeamResults] = useState<TeamRankingPreview[]>([]);
  const [manualTeamRanks, setManualTeamRanks] = useState<Record<InternalTeamColor, number>>({
    RED: 1,
    BLUE: 2,
    WHITE: 3
  });
  const [loadError, setLoadError] = useState<string>();
  const [aliasDrafts, setAliasDrafts] = useState<AliasDraft[]>([]);
  const [aliasDraft, setAliasDraft] = useState<AliasDraft>({
    playerId: "",
    rawName: "",
    aliasType: "MANUAL"
  });

  const playerOptions = useMemo(
    () => players.map((player) => ({ label: player.name, value: player.id })),
    [players]
  );
  const participantOptions = useMemo(() => [...playerOptions,
    ...(matchDay?.trialPlayers ?? []).map((trial) => ({ label: `${trial.name}（${trial.confirmed ? "试训" : "试训待确认"}）`, value: `trial:${trial.id}` }))
  ], [playerOptions, matchDay?.trialPlayers]);

  function eventPlayerRef(value: string, rawName?: string): PlayerRef {
    if (!value.startsWith("trial:")) return playerRefFromId(value, players, rawName);
    const trial = matchDay?.trialPlayers?.find((item) => item.id === value.slice(6));
    return { playerId: null, trialPlayerId: trial?.id ?? null, rawName: rawName || trial?.name || "", matchedName: trial?.name, confidence: 1, candidates: [] };
  }

  async function load() {
    setLoading(true);
    try {
      setLoadError(undefined);
      const [matchRow, playerRows] = await Promise.all([
        requestJson<MatchDay>(`/api/matchdays/${params.id}`),
        requestJson<Player[]>("/api/players")
      ]);
      setPlayers(playerRows);
      const parsedResult = (matchRow.parseResults?.[0]?.parsedJson ?? null) as ParsedMatch | null;
      const restored = parsedResult ? restoreEventTeams(parsedResult, matchRow) : null;
      const trials = restored ? assignAutomaticTrials(restored, matchRow.trialPlayers ?? [], () => crypto.randomUUID()) : matchRow.trialPlayers ?? [];
      setMatchDay({ ...matchRow, trialPlayers: trials.map((trial) => ({ ...trial, matchDayId: matchRow.id })) });
      setParsed(restored);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载解析结果失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  const eventRows = useMemo<EventRow[]>(() => {
    if (!parsed) return [];
    if (parsed.matchType === "internal") {
      return (parsed.games ?? []).flatMap((game, gameIndex) =>
        game.events.map((event, eventIndex) => ({
          ...event,
          key: `${game.sectionNo}-${eventIndex}-${event.rawText}`,
          gameIndex,
          eventIndex,
          sectionNo: game.sectionNo
        }))
      );
    }
    return (parsed.events ?? []).map((event, eventIndex) => ({
      ...event,
      key: `external-${eventIndex}-${event.rawText}`,
      eventIndex
    }));
  }, [parsed]);

  const eventInspection = useMemo(() => parsed?.matchType === "internal" && matchDay
    ? inspectInternalEvents({ games: parsed.games ?? [] }, matchDay.assignments ?? [], matchDay.trialPlayers ?? [])
    : { issues: [], exceptions: [], resolutions: [] }, [parsed, matchDay]);

  const awardRows = useMemo<AwardRow[]>(() =>
    (parsed?.awards ?? []).flatMap((award, awardIndex) => {
      if (award.players.length === 0) {
        return [{
          key: `award-${awardIndex}-empty`,
          awardIndex,
          playerIndex: -1,
          award,
          player: playerRefFromId(null, [])
        }];
      }

      return award.players.map((player, playerIndex) => ({
        key: `award-${awardIndex}-${playerIndex}`,
        awardIndex,
        playerIndex,
        award,
        player
      }));
    }),
    [parsed]
  );

  function updateParsed(mutator: (next: ParsedMatch) => void) {
    if (submitting.current) return;
    setEventConfirmationToken(undefined);
    setPendingTeamResults([]);
    setConfirmationError(undefined);
    setPendingEventConfirmation((current) => current ? {} : null);
    setParsed((current) => {
      if (!current) return current;
      const next = cloneParsed(current);
      mutator(next);
      return next;
    });
  }

  function updateGame(gameIndex: number, patch: Partial<ParsedGame>) {
    updateParsed((next) => {
      if (next.matchType !== "internal" || !next.games?.[gameIndex]) return;
      next.games[gameIndex] = { ...next.games[gameIndex], ...patch };
    });
  }

  function changeTrials(trials: TrialDraft[]) {
    if (submitting.current) return;
    setMatchDay((current) => current ? { ...current, trialPlayers: trials } : current);
    updateParsed((next) => {
      for (const game of next.games ?? []) for (const event of game.events) {
        for (const field of ["scorer", "assist"] as const) {
          const ref = event[field];
          if (!ref || ref.playerId || ref.trialPlayerId) continue;
          const trial = trials.find((item) => item.name === ref.rawName.trim());
          if (trial) event[field] = { ...ref, trialPlayerId: trial.id, matchedName: trial.name };
        }
      }
    });
  }

  async function resolveTrial(trialId: string, choice: TrialIdentityChoice) {
    if (submitting.current || !matchDay || !parsed) return;
    submitting.current = true;
    setSaving(true);
    try {
      const result = await requestJson<TrialResolutionResponse>("/api/players/resolve-trial", {
        method: "POST", body: JSON.stringify({ trialId, ...choice, matchDayId: matchDay.id,
          matchDayVersion: matchDay.updatedAt, trialPlayers: matchDay.trialPlayers ?? [],
          participantCorrections: matchDay.participantCorrections ?? [], parsedJson: parsed })
      });
      setPlayers((current) => [...current.filter((player) => player.id !== result.player.id), result.player]);
      setMatchDay((current) => current ? { ...current, trialPlayers: result.trialPlayers,
        participantCorrections: result.participantCorrections, updatedAt: result.matchDayVersion ?? current.updatedAt } : current);
      setParsed((result.parsedJson as ParsedMatch | undefined) ?? resolveTrialReferences(parsed, trialId, result.player).parsed);
      setEventConfirmationToken(undefined);
      setPendingEventConfirmation(null);
      setPendingTeamResults([]);
      setConfirmationError(undefined);
    } finally { submitting.current = false; setSaving(false); }
  }

  function updateEvent(row: EventRow, patch: Partial<ParsedEvent>) {
    updateParsed((next) => {
      if (next.matchType === "internal") {
        const game = next.games?.[row.gameIndex ?? -1];
        if (!game?.events[row.eventIndex]) return;
        game.events[row.eventIndex] = { ...game.events[row.eventIndex], ...patch };
      } else if (next.events?.[row.eventIndex]) {
        next.events[row.eventIndex] = { ...next.events[row.eventIndex], ...patch };
      }
    });
  }

  function moveEvent(row: EventRow, sectionNo: number) {
    updateParsed((next) => {
      if (next.matchType !== "internal" || row.gameIndex === undefined) return;
      const fromGame = next.games?.[row.gameIndex];
      const toGame = next.games?.find((game) => game.sectionNo === sectionNo);
      if (!fromGame || !toGame) return;
      const [event] = fromGame.events.splice(row.eventIndex, 1);
      if (event) toGame.events.push(event);
    });
  }

  function deleteEvent(row: EventRow) {
    updateParsed((next) => {
      if (next.matchType === "internal") {
        const game = next.games?.[row.gameIndex ?? -1];
        if (!game) return;
        game.events.splice(row.eventIndex, 1);
      } else {
        next.events?.splice(row.eventIndex, 1);
      }
    });
  }

  function addEvent(type: ParsedEvent["type"] = "goal") {
    updateParsed((next) => {
      if (next.matchType === "internal") {
        const game = next.games?.[0];
        if (!game) return;
        game.events.push({ ...emptyEvent(), type });
      } else {
        next.events = [...(next.events ?? []), emptyEvent("external")];
      }
    });
  }

  function updateBonus(index: number, patch: Partial<BonusPoint>) {
    updateParsed((next) => {
      if (!next.bonusPoints?.[index]) return;
      next.bonusPoints[index] = { ...next.bonusPoints[index], ...patch };
    });
  }

  function deleteBonus(index: number) {
    updateParsed((next) => {
      next.bonusPoints?.splice(index, 1);
    });
  }

  function addBonus() {
    updateParsed((next) => {
      next.bonusPoints = [
        ...(next.bonusPoints ?? []),
        {
          player: playerRefFromId(null, players),
          points: 1,
          reason: "",
          rawText: ""
        }
      ];
    });
  }

  function updateAward(row: AwardRow, patch: Partial<ParsedAward>) {
    updateParsed((next) => {
      if (!next.awards?.[row.awardIndex]) return;
      next.awards[row.awardIndex] = { ...next.awards[row.awardIndex], ...patch };
    });
  }

  function updateAwardPlayer(row: AwardRow, playerId: string) {
    updateParsed((next) => {
      const award = next.awards?.[row.awardIndex];
      if (!award) return;
      const player = playerRefFromId(playerId, players, row.player.rawName);
      if (row.playerIndex < 0) award.players.push(player);
      else award.players[row.playerIndex] = player;
    });
  }

  function deleteAwardRow(row: AwardRow) {
    updateParsed((next) => {
      const award = next.awards?.[row.awardIndex];
      if (!award) return;
      if (row.playerIndex < 0 || award.players.length <= 1) {
        next.awards?.splice(row.awardIndex, 1);
      } else {
        award.players.splice(row.playerIndex, 1);
      }
    });
  }

  function addAward() {
    updateParsed((next) => {
      next.awards = [
        ...(next.awards ?? []),
        {
          name: "最佳后卫",
          players: [playerRefFromId(null, players)],
          points: 0,
          rawText: ""
        }
      ];
    });
  }

  function addAliasDraft() {
    if (!aliasDraft.playerId || !aliasDraft.rawName.trim()) return;
    setAliasDrafts((current) => [...current, aliasDraft]);
    setAliasDraft({ playerId: "", rawName: "", aliasType: "MANUAL" });
  }

  function validateBeforeConfirm() {
    if (!parsed) return "没有可确认的解析结果";
    const events = parsed.matchType === "internal" ? parsed.games?.flatMap((game) => game.events) ?? [] : parsed.events ?? [];
    if (events.some((event) => !event.scorer.playerId && !event.scorer.trialPlayerId)) {
      return "仍有进球球员没有匹配，请先在表格里选择球员";
    }
    if (matchDay?.trialPlayers?.some((trial) => !trial.confirmed)) return "仍有试训球员待确认，请在试训区域确认身份或匹配正式球员";
    if (eventInspection.issues.length) return eventInspection.issues[0];
    if ((parsed.awards ?? []).some((award) => award.players.length === 0 || award.players.some((player) => !player.playerId))) {
      return "仍有奖项球员没有匹配，请先在奖项表里选择球员";
    }
    if ((parsed.bonusPoints ?? []).some((bonus) => !bonus.player.playerId)) {
      return "仍有加分球员没有匹配，请先在加分表里选择球员";
    }
    return null;
  }

  function returnToEdit() {
    if (!matchDay) return;
    const entryPath = matchDay.type === "INTERNAL" ? "/matchdays/internal" : "/matchdays/external";
    router.push(`${entryPath}?edit=${params.id}`);
  }

  async function confirm(ranks?: ManualTeamRank[], confirmationToken?: string, approveExceptions = false) {
    if (submitting.current) return;
    const error = validateBeforeConfirm();
    if (error) { message.error(error); return; }
    if (ranks && new Set(ranks.map((row) => row.rank)).size !== 3) {
      message.error("第 1、2、3 名不能重复");
      return;
    }
    submitting.current = true;
    setSaving(true);
    setConfirmationError(undefined);
    try {
      let token = confirmationToken;
      // A dialog edit needs a new proof for exactly the content the operator just approved.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`/api/matchdays/${params.id}/confirm`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parsedJson: parsed, matchDayVersion: matchDay?.updatedAt,
            eventConfirmationToken: token, saveAliases: aliasDrafts, manualTeamRanks: ranks,
            ...(parsed?.matchType === "internal" ? { teamAssignments: matchDay?.assignments, trialPlayers: matchDay?.trialPlayers ?? [] } : {}) })
        });
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string; message?: string; teamResults?: TeamRankingPreview[];
          exceptions?: EventException[]; confirmationToken?: string;
        };
        if (response.status === 409 && payload.code === "MATCH_EVENT_CONFIRMATION_REQUIRED") {
          setPendingEventConfirmation({ confirmationToken: payload.confirmationToken });
          setPendingTeamResults([]);
          setEventConfirmationToken(undefined);
          if (approveExceptions && attempt === 0 && payload.confirmationToken
            && JSON.stringify(payload.exceptions) === JSON.stringify(eventInspection.exceptions)) {
            token = payload.confirmationToken;
            continue;
          }
          return;
        }
        if (response.status === 409 && payload.code === "TEAM_RANKING_CONFIRMATION_REQUIRED" && payload.teamResults?.length === 3) {
          setPendingEventConfirmation(null);
          setEventConfirmationToken(token);
          setPendingTeamResults(payload.teamResults);
          setManualTeamRanks(Object.fromEntries(payload.teamResults.map((result) => [result.teamColor, result.rank ?? 3])) as Record<InternalTeamColor, number>);
          return;
        }
        if (!response.ok) throw new Error(payload.message ?? `确认失败：${response.status}`);
        setPendingTeamResults([]);
        setPendingEventConfirmation(null);
        setEventConfirmationToken(undefined);
        message.success(matchDay?.parseStatus === "CONFIRMED" ? "修改已保存并重新入库" : "已确认入库");
        router.push(`/matchdays/${params.id}/share`);
        return;
      }
    } catch (submitError) {
      const text = submitError instanceof Error ? submitError.message : "确认失败";
      setConfirmationError(text);
      message.error(text);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const gameColumns: ColumnsType<ParsedGame> = [
    { title: "节次", dataIndex: "sectionNo", width: 80 },
    {
      title: "队伍 A",
      render: (_, game, index) => (
        <Select
          style={{ width: 110 }}
          value={game.teamA}
          options={teamOptions.filter((item) => item.value !== "external")}
          onChange={(teamA) => updateGame(index, { teamA })}
        />
      )
    },
    {
      title: "队伍 B",
      render: (_, game, index) => (
        <Select
          style={{ width: 110 }}
          value={game.teamB}
          options={teamOptions.filter((item) => item.value !== "external")}
          onChange={(teamB) => updateGame(index, { teamB })}
        />
      )
    },
    {
      title: "A 得分",
      render: (_, game, index) => (
        <InputNumber min={0} value={game.scoreA} onChange={(scoreA) => updateGame(index, { scoreA: scoreA ?? 0 })} />
      )
    },
    {
      title: "B 得分",
      render: (_, game, index) => (
        <InputNumber min={0} value={game.scoreB} onChange={(scoreB) => updateGame(index, { scoreB: scoreB ?? 0 })} />
      )
    },
    {
      title: "原文",
      render: (_, game, index) => (
        <Input value={game.rawText} onChange={(event) => updateGame(index, { rawText: event.target.value })} />
      )
    }
  ];

  const eventLabel = (row: EventRow, field: string) => "第" + (row.sectionNo ?? 0) + "节事件" + (row.eventIndex + 1) + field;
  const eventColumns: ColumnsType<EventRow> = [
    {
      title: "事件类型", width: 125,
      render: (_, row) => parsed?.matchType === "internal" ? (
        <Select aria-label={eventLabel(row, "类型")} style={{ width: 110 }} value={row.type} disabled={saving}
          options={[{ label: "普通进球", value: "goal" }, { label: "乌龙球", value: "own_goal" }]}
          onChange={(type: ParsedEvent["type"]) => {
            const game = parsed.games?.[row.gameIndex ?? -1];
            const team = game && row.team ? (row.team === game.teamA ? game.teamB : game.teamA) : row.team;
            const apply = () => updateEvent(row, { type, team, assist: type === "own_goal" ? null : row.assist, needsReview: true });
            if (type === "own_goal") modal.confirm({ title: "转为乌龙球", content: "乌龙球无助攻，转换后将清空助攻并移入乌龙球区域；得分队切换为受益队，请核对。", okText: "确认转换", cancelText: "取消", onOk: apply });
            else apply();
          }} />
      ) : "普通进球"
    },
    {
      title: "节次", width: 100,
      render: (_, row) => parsed?.matchType === "internal" ? (
        <Select aria-label={eventLabel(row, "节次")} style={{ width: 82 }} value={row.sectionNo} disabled={saving}
          options={(parsed.games ?? []).map((game) => ({ label: "第 " + game.sectionNo + " 节", value: game.sectionNo }))}
          onChange={(sectionNo) => moveEvent(row, sectionNo)} />
      ) : "-"
    },
    {
      title: "得分队伍", width: 145,
      render: (_, row) => {
        const game = parsed?.games?.[row.gameIndex ?? -1];
        if (parsed?.matchType !== "internal" || !game) return <Tag>队外</Tag>;
        const exceptional = eventInspection.exceptions.some((item) => item.key === row.gameIndex + ":" + row.eventIndex);
        return <Space direction="vertical" size={4}>
          <Select aria-label={eventLabel(row, "得分队")} style={{ width: 110 }} disabled={saving}
            value={row.team} placeholder="选择得分队" status={!row.team ? "warning" : undefined}
            options={[game.teamA, game.teamB].map((value) => ({ label: teamLabels[value], value }))}
            onChange={(team) => updateEvent(row, { team, needsTeamSelection: false, needsReview: true })} />
          {exceptional ? <Tag color="gold">需二次确认</Tag> : null}
        </Space>;
      }
    },
    {
      title: "进球／乌龙球员", width: 180,
      render: (_, row) => {
        const originalTeam = matchDay ? assignedTeamForPlayer(matchDay, row.scorer.playerId) : undefined;
        return <Space direction="vertical" size={4}>
          <Select aria-label={eventLabel(row, "球员")} showSearch optionFilterProp="label" style={{ width: 160 }}
            disabled={saving} value={row.scorer.trialPlayerId ? `trial:${row.scorer.trialPlayerId}` : row.scorer.playerId ?? undefined} options={participantOptions}
            status={!row.scorer.playerId && !row.scorer.trialPlayerId ? "error" : undefined}
            onChange={(playerId) => {
              const game = parsed?.games?.[row.gameIndex ?? -1];
              const scorer = eventPlayerRef(playerId, row.scorer.rawName);
              const team = game && matchDay
                ? row.team ?? (row.needsTeamSelection ? undefined : defaultEventTeam({ ...row, scorer }, game, matchDay.assignments ?? []))
                : "external";
              updateEvent(row, { scorer, team, needsReview: true });
            }} />
          {parsed?.matchType === "internal" ? <Typography.Text type="secondary">
            {row.scorer.trialPlayerId ? "试训，不计正式个人数据" : originalTeam ? `当天${teamLabels[originalTeam]}` : "正式球员 · 当天未分队 · 代打"}
          </Typography.Text> : null}
        </Space>;
      }
    },
    {
      title: "助攻球员", key: "assist", width: 180,
      render: (_, row) => {
        const originalTeam = matchDay ? assignedTeamForPlayer(matchDay, row.assist?.playerId) : undefined;
        return <Space direction="vertical" size={4}>
          <Select aria-label={eventLabel(row, "助攻")} allowClear showSearch optionFilterProp="label" style={{ width: 160 }}
            value={row.assist?.trialPlayerId ? `trial:${row.assist.trialPlayerId}` : row.assist?.playerId ?? undefined} options={participantOptions} disabled={saving || row.type === "own_goal"}
            placeholder={row.type === "own_goal" ? "乌龙球不计助攻" : "无助攻"}
            onChange={(playerId) => updateEvent(row, { assist: playerId ? eventPlayerRef(playerId, row.assist?.rawName) : null })} />
          {row.assist && parsed?.matchType === "internal" ? <Typography.Text type="secondary">{row.assist.trialPlayerId ? "试训，不计正式个人数据" : originalTeam ? `当天${teamLabels[originalTeam]}` : "正式球员 · 当天未分队 · 代打"}</Typography.Text> : null}
        </Space>;
      }
    },
    {
      title: "数量", width: 90,
      render: (_, row) => <InputNumber aria-label={eventLabel(row, "数量")} min={1} precision={0} value={row.count} disabled={saving}
        onChange={(count) => updateEvent(row, { count: count ?? 1 })} />
    },
    {
      title: "需复核", width: 90,
      render: (_, row) => <Checkbox aria-label={eventLabel(row, "需复核")} checked={row.needsReview} disabled={saving}
        onChange={(event) => updateEvent(row, { needsReview: event.target.checked })} />
    },
    {
      title: "原文",
      render: (_, row) => <Input aria-label={eventLabel(row, "原文")} value={row.rawText} disabled={saving}
        onChange={(event) => updateEvent(row, { rawText: event.target.value })} />
    },
    {
      title: "操作", width: 180,
      render: (_, row) => <Space>
        {parsed?.matchType === "internal" && row.type === "goal" ? <Button size="small" disabled={saving} aria-label={eventLabel(row, "转为乌龙球")} onClick={() => {
          const game = parsed.games?.[row.gameIndex ?? -1];
          const team = game && row.team ? (row.team === game.teamA ? game.teamB : game.teamA) : row.team;
          modal.confirm({ title: "转为乌龙球", content: "乌龙球无助攻，转换后将清空助攻并移入乌龙球区域；请核对受益队。", okText: "确认转换", cancelText: "取消", onOk: () => updateEvent(row, { type: "own_goal", team, assist: null, needsReview: true }) });
        }}>转为乌龙</Button> : null}
        <Button aria-label={eventLabel(row, "删除")} danger icon={<Trash2 size={16} />} disabled={saving} onClick={() => deleteEvent(row)} />
      </Space>
    }
  ];

  const awardColumns: ColumnsType<AwardRow> = [
    {
      title: "奖项",
      width: 180,
      render: (_, row) => (
        <Input
          value={row.award.name}
          onChange={(event) => updateAward(row, { name: event.target.value })}
        />
      )
    },
    {
      title: "获奖球员",
      width: 220,
      render: (_, row) => (
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 200 }}
          value={row.player.playerId ?? undefined}
          options={playerOptions}
          status={!row.player.playerId ? "error" : undefined}
          placeholder="选择最佳后卫"
          onChange={(playerId) => updateAwardPlayer(row, playerId)}
        />
      )
    },
    {
      title: "原文",
      render: (_, row) => (
        <Input
          value={row.award.rawText}
          onChange={(event) => updateAward(row, { rawText: event.target.value })}
        />
      )
    },
    {
      title: "操作",
      width: 80,
      render: (_, row) => (
        <Button danger icon={<Trash2 size={16} />} onClick={() => deleteAwardRow(row)} />
      )
    }
  ];

  const bonusColumns: ColumnsType<BonusPoint> = [
    {
      title: "球员",
      render: (_, bonus, index) => (
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: 180 }}
          value={bonus.player.playerId ?? undefined}
          options={playerOptions}
          onChange={(playerId) => updateBonus(index, { player: playerRefFromId(playerId, players, bonus.player.rawName) })}
        />
      )
    },
    {
      title: "分数",
      width: 100,
      render: (_, bonus, index) => (
        <InputNumber value={bonus.points} onChange={(points) => updateBonus(index, { points: points ?? 0 })} />
      )
    },
    {
      title: "原因",
      render: (_, bonus, index) => (
        <Input value={bonus.reason} onChange={(event) => updateBonus(index, { reason: event.target.value })} />
      )
    },
    {
      title: "原文",
      render: (_, bonus, index) => (
        <Input value={bonus.rawText} onChange={(event) => updateBonus(index, { rawText: event.target.value })} />
      )
    },
    {
      title: "操作",
      width: 80,
      render: (_, __, index) => <Button danger icon={<Trash2 size={16} />} onClick={() => deleteBonus(index)} />
    }
  ];

  const isEditingConfirmed = matchDay?.parseStatus === "CONFIRMED";
  return (
    <>
      <div className="page-title">
        <div>
          <h1>{isEditingConfirmed ? "修改已入库比赛" : "AI 解析确认"}</h1>
          <p>{isEditingConfirmed ? "修改后重新入库会覆盖这场比赛原有数据，不会重复累计" : "解析结果已转换成表格，可直接修改比分、进球、助攻和球员匹配后确认入库"}</p>
        </div>
        <Space>
          <Button icon={<ArrowLeft size={16} />} onClick={returnToEdit} disabled={!matchDay}>
            返回修改
          </Button>
          <Button type="primary" icon={<Save size={16} />} onClick={() => void confirm()} loading={saving} disabled={loading || !parsed}>
            {isEditingConfirmed ? "保存修改并重新入库" : "确认入库"}
          </Button>
        </Space>
      </div>

      {loadError ? <Alert type="error" showIcon message="加载失败" description={loadError} style={{ marginBottom: 16 }} /> : null}

      {confirmationError && !pendingEventConfirmation ? <Alert type="error" showIcon message={confirmationError} style={{ marginBottom: 16 }} /> : null}

      {isEditingConfirmed ? (
        <Alert
          type="warning"
          showIcon
          message="正在修改已入库比赛"
          description="保存时会先清理该场原有的比分、进球、助攻、积分和奖项，再按当前内容重新写入。"
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {matchDay ? (
        <div className="section-panel">
          <Descriptions bordered size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label="日期">{matchDay.date.slice(0, 10)}</Descriptions.Item>
            <Descriptions.Item label="类型">{matchDay.type === "INTERNAL" ? "队内赛" : "队外赛"}</Descriptions.Item>
            <Descriptions.Item label="状态">{matchDay.parseStatus}</Descriptions.Item>
          </Descriptions>
        </div>
      ) : null}

      <div className="section-panel">
        <Typography.Title level={4}>原始赛后文本</Typography.Title>
        <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{matchDay?.rawText}</Typography.Paragraph>
      </div>

      {parsed?.uncertainItems?.length ? (
        <Alert
          type="warning"
          showIcon
          message="需要人工确认的模糊项"
          description={
            <Space direction="vertical">
              {parsed.uncertainItems.map((item, index) => (
                <span key={`${item.rawText}-${index}`}>
                  {item.rawText}：{item.reason}
                </span>
              ))}
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="section-panel">
        <Typography.Title level={4}>保存新别名</Typography.Title>
        <Space.Compact style={{ width: "100%" }}>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 260 }}
            placeholder="选择球员"
            value={aliasDraft.playerId || undefined}
            onChange={(playerId) => setAliasDraft((current) => ({ ...current, playerId }))}
            options={playerOptions}
          />
          <Input
            placeholder="原文里的名字"
            value={aliasDraft.rawName}
            onChange={(event) => setAliasDraft((current) => ({ ...current, rawName: event.target.value }))}
          />
          <Select
            style={{ width: 150 }}
            value={aliasDraft.aliasType}
            onChange={(aliasType) => setAliasDraft((current) => ({ ...current, aliasType }))}
            options={[
              { label: "手动", value: "MANUAL" },
              { label: "昵称", value: "NICKNAME" },
              { label: "错别字", value: "TYPO" },
              { label: "简称", value: "SHORT_NAME" }
            ]}
          />
          <Button icon={<Plus size={16} />} onClick={addAliasDraft}>
            添加
          </Button>
        </Space.Compact>
        <Space wrap style={{ marginTop: 12 }}>
          {aliasDrafts.map((draft, index) => (
            <Tag
              key={`${draft.playerId}-${draft.rawName}-${index}`}
              closable
              closeIcon={<Trash2 size={12} />}
              onClose={(event) => {
                event.preventDefault();
                setAliasDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
              }}
            >
              {players.find((player) => player.id === draft.playerId)?.name}: {draft.rawName}
            </Tag>
          ))}
        </Space>
      </div>
      {parsed?.matchType === "internal" ? (
        <>
        <TrialPlayersPanel trials={matchDay?.trialPlayers ?? []} players={players} games={parsed.games ?? []}
          disabled={saving} onChange={changeTrials} onResolve={resolveTrial}
          onRemove={(trialId) => {
            if (eventRows.some((row) => row.scorer.trialPlayerId === trialId || row.assist?.trialPlayerId === trialId)) {
              message.warning("该试训球员仍有关联事件，请先更正或删除事件，或匹配正式球员"); return;
            }
            changeTrials((matchDay?.trialPlayers ?? []).filter((trial) => trial.id !== trialId));
          }} />

        <div className="section-panel">
          <Typography.Title level={4}>小节比分</Typography.Title>
          <Table
            rowKey="sectionNo"
            loading={loading}
            columns={gameColumns}
            dataSource={parsed.games ?? []}
            pagination={false}
            scroll={{ x: 850 }}
          />
        </div>
        </>
      ) : null}

      <div className="section-panel">
        <div className="toolbar">
          <Typography.Title level={4} style={{ margin: 0 }}>
            普通进球
          </Typography.Title>
          <Button icon={<Plus size={16} />} onClick={() => addEvent()} disabled={loading || !parsed || saving}>
            新增进球
          </Button>
        </div>
        {parsed?.matchType === "internal" ? (
          <Alert
            type="info"
            showIcon
            message="临时代打与乌龙球将在入库前再次确认"
            description="按实际情况选择得分队。正式球员与试训球员配合时，正式球员的数据正常统计；个人积分按当天原队排名计算。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Table rowKey="key" loading={loading} columns={eventColumns.filter((column) => column.title !== "事件类型").map((column) => column.title === "进球／乌龙球员" ? { ...column, title: "进球球员" } : column)} dataSource={eventRows.filter((row) => row.type === "goal")} pagination={false} scroll={{ x: 1350 }} />
      </div>

      {parsed?.matchType === "internal" ? <section className="section-panel" aria-label="乌龙球">
        <div className="toolbar">
          <Typography.Title level={4} style={{ margin: 0 }}>乌龙球</Typography.Title>
          <Button icon={<Plus size={16} />} onClick={() => addEvent("own_goal")} disabled={loading || saving}>新增乌龙球</Button>
        </div>
        <Typography.Paragraph type="secondary">仅计受益队比分；正式球员独立累计乌龙数，不计普通进球和助攻。</Typography.Paragraph>
        <Table rowKey="key" columns={eventColumns.filter((column) => column.key !== "assist").map((column) =>
          column.title === "进球／乌龙球员" ? { ...column, title: "乌龙球员" } : column.title === "得分队伍" ? { ...column, title: "受益队" } : column
        )} dataSource={eventRows.filter((row) => row.type === "own_goal")} pagination={false} scroll={{ x: 1150 }} />
      </section> : null}

      <div className="section-panel">
        <div className="toolbar">
          <Typography.Title level={4} style={{ margin: 0 }}>
            特殊积分与奖项
          </Typography.Title>
          <Button icon={<Plus size={16} />} onClick={addAward}>
            新增最佳后卫
          </Button>
        </div>
        <Table
          rowKey="key"
          columns={awardColumns}
          scroll={{ x: 700 }}
          dataSource={awardRows}
          pagination={false}
          locale={{ emptyText: "赛后文本中未解析到最佳后卫" }}
        />
        <div className="toolbar" style={{ marginTop: 20 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            额外加分
          </Typography.Title>
          <Button icon={<Plus size={16} />} onClick={addBonus}>
            新增加分
          </Button>
        </div>
        <Table
          rowKey={(_, index) => `bonus-${index}`}
          columns={bonusColumns}
          scroll={{ x: 800 }}
          dataSource={parsed?.bonusPoints ?? []}
          pagination={false}
        />
      </div>

      <MatchEventConfirmationModal open={pendingEventConfirmation !== null} exceptions={eventInspection.exceptions}
        trialNames={(matchDay?.trialPlayers ?? []).map((trial) => trial.name)}
        issues={eventInspection.issues} saving={saving} error={confirmationError}
        onCancel={() => { if (!saving) { setPendingEventConfirmation(null); setEventConfirmationToken(undefined); } }}
        onTeamChange={(event, team) => {
          const row = eventRows.find((item) => item.gameIndex === event.gameIndex && item.eventIndex === event.eventIndex);
          if (row) updateEvent(row, { team, needsTeamSelection: false, needsReview: true });
        }}
        onConfirm={() => void confirm(undefined, pendingEventConfirmation?.confirmationToken, true)} />
      <Modal
        title="人工确认三队排名"
        open={pendingTeamResults.length === 3}
        okText="确认排名并入库"
        cancelText="返回修改比分"
        confirmLoading={saving}
        maskClosable={false}
        onCancel={() => {
          if (!saving) setPendingTeamResults([]);
        }}
        onOk={() =>
          void confirm(
            (["RED", "BLUE", "WHITE"] as InternalTeamColor[]).map((teamColor) => ({
              teamColor,
              rank: manualTeamRanks[teamColor]
            })), eventConfirmationToken
          )
        }
      >
        <Alert
          type="warning"
          showIcon
          message="自动规则无法完全区分名次"
          description="当前比赛尚未入库。请为红、蓝、白三队分别指定第 1、2、3 名，确认后才会写入比赛结果和球员积分。"
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {[...pendingTeamResults]
            .sort((left, right) => left.teamColor.localeCompare(right.teamColor))
            .map((result) => (
              <div
                key={result.teamColor}
                style={{
                  display: "grid",
                  gridTemplateColumns: "72px minmax(0, 1fr) 108px",
                  alignItems: "center",
                  gap: 12
                }}
              >
                <Typography.Text strong>{internalTeamLabels[result.teamColor]}</Typography.Text>
                <Typography.Text type="secondary">
                  比赛积分 {result.matchPoints}，净胜球 {result.goalDifference > 0 ? "+" : ""}
                  {result.goalDifference}
                </Typography.Text>
                <Select
                  aria-label={`${internalTeamLabels[result.teamColor]}排名`}
                  value={manualTeamRanks[result.teamColor]}
                  options={[1, 2, 3].map((rank) => ({ label: `第 ${rank} 名`, value: rank }))}
                  onChange={(rank) =>
                    setManualTeamRanks((current) => ({ ...current, [result.teamColor]: rank }))
                  }
                />
              </div>
            ))}
        </Space>
      </Modal>

    </>
  );
}
