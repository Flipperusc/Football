"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { App, Alert, Button, Empty, Spin, Tag } from "antd";
import { ArrowLeft, Download, RefreshCw, Share2, Trophy } from "lucide-react";
import { toPng } from "html-to-image";
import { requestJson } from "@/lib/client-types";
import { goalEventMarker, type StoredGoalAttribution } from "@/lib/match-events";

type TeamColor = "RED" | "BLUE" | "WHITE" | "EXTERNAL";
type InternalTeamColor = Exclude<TeamColor, "EXTERNAL">;

type ShareMatchDay = {
  id: string;
  date: string;
  type: "INTERNAL" | "EXTERNAL";
  parseStatus: "CONFIRMED";
  season?: { name: string };
  internalGames: {
    id: string;
    sectionNo: number;
    teamA: InternalTeamColor;
    teamB: InternalTeamColor;
    scoreA: number;
    scoreB: number;
  }[];
  goalEvents: (StoredGoalAttribution & {
    id: string;
    internalGameId?: string | null;
    teamColor?: TeamColor | null;
    scorerId: string;
    assistPlayerId?: string | null;
    count: number;
    scorer: { id: string; name: string };
    assistPlayer?: { id: string; name: string } | null;
  })[];
  teamResults: {
    teamColor: InternalTeamColor;
    matchPoints: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    rank?: number | null;
  }[];
};

const teams: InternalTeamColor[] = ["BLUE", "RED", "WHITE"];
const teamLabels: Record<InternalTeamColor, string> = { BLUE: "蓝", RED: "红", WHITE: "白" };
const teamClassNames: Record<InternalTeamColor, string> = {
  BLUE: "share-team-blue",
  RED: "share-team-red",
  WHITE: "share-team-white"
};

function teamScore(game: ShareMatchDay["internalGames"][number], teamColor: InternalTeamColor) {
  if (game.teamA === teamColor) return game.scoreA;
  if (game.teamB === teamColor) return game.scoreB;
  return null;
}

function mergeNameCounts(items: { name: string; count: number }[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
  return Array.from(counts.entries()).map(([name, count]) => name + (count > 1 ? "×" + count : "")).join("、");
}

function goalsText(
  game: ShareMatchDay["internalGames"][number],
  teamColor: InternalTeamColor,
  events: ShareMatchDay["goalEvents"]
) {
  const score = teamScore(game, teamColor);
  if (score === null) return "—";
  const text = mergeNameCounts(
    events
      .filter((event) => event.internalGameId === game.id && event.teamColor === teamColor)
      .map((event) => ({ name: event.scorer.name + goalEventMarker(event, game), count: event.count }))
  );
  return text || (score === 0 ? "0" : String(score));
}

function assistsText(
  game: ShareMatchDay["internalGames"][number],
  teamColor: InternalTeamColor,
  events: ShareMatchDay["goalEvents"]
) {
  if (teamScore(game, teamColor) === null) return "—";
  return mergeNameCounts(
    events
      .filter((event) => event.kind !== "OWN_GOAL" && event.internalGameId === game.id && event.teamColor === teamColor && event.assistPlayer)
      .map((event) => ({ name: event.assistPlayer!.name + goalEventMarker(event, game, "assist"), count: event.count }))
  ) || "—";
}

export default function MatchDaySharePage() {
  const params = useParams<{ id: string }>();
  const { message } = App.useApp();
  const cardRef = useRef<HTMLDivElement>(null);
  const [matchDay, setMatchDay] = useState<ShareMatchDay>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load() {
    setLoading(true);
    try {
      setLoadError(undefined);
      setMatchDay(await requestJson<ShareMatchDay>("/api/public/matchdays/" + params.id));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载赛后战报失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  const resultPoints = useMemo(
    () => new Map((matchDay?.teamResults ?? []).map((result) => [result.teamColor, result.matchPoints])),
    [matchDay?.teamResults]
  );
  const leaderPoints = Math.max(...Array.from(resultPoints.values()), 0);

  async function downloadImage() {
    if (!cardRef.current || !matchDay) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      const card = cardRef.current;
      const exportWidth = Math.ceil(
        Math.max(card.scrollWidth, card.getBoundingClientRect().width)
      ) + 8;
      const exportHeight = Math.ceil(
        Math.max(card.scrollHeight, card.getBoundingClientRect().height)
      ) + 2;
      const dataUrl = await toPng(card, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        pixelRatio: 2,
        width: exportWidth,
        height: exportHeight,
        style: {
          width: `${exportWidth}px`,
          minWidth: `${exportWidth}px`,
          maxWidth: "none",
          margin: "0",
          overflow: "visible"
        }
      });
      const link = document.createElement("a");
      link.download = "灵眸GPU-赛后战报-" + matchDay.date.slice(0, 10) + ".png";
      link.href = dataUrl;
      link.click();
      message.success("高清战报图片已生成");
    } catch {
      message.error("生成图片失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  }

  async function shareLink() {
    if (!matchDay) return;
    const payload = {
      title: "灵眸GPU 队内赛赛后战报",
      text: matchDay.date.slice(0, 10) + " 队内赛结果",
      url: window.location.href
    };
    try {
      if (navigator.share) await navigator.share(payload);
      else {
        await navigator.clipboard.writeText(window.location.href);
        message.success("分享链接已复制");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") message.error("分享失败，请稍后重试");
    }
  }

  return (
    <main className="public-share-page">
      <header className="public-share-topbar">
        <Link className="public-brand" href="/">
          <span className="public-brand-mark"><Trophy size={20} /></span>
          <span><strong>灵眸GPU</strong><small>FOOTBALL CLUB</small></span>
        </Link>
        <Link href="/"><Button type="text" icon={<ArrowLeft size={16} />}>返回球队首页</Button></Link>
      </header>

      <section className="public-share-intro">
        <div>
          <span className="public-eyebrow">MATCH REPORT</span>
          <h1>赛后战报</h1>
        </div>
        <div className="public-share-actions">
          <Button icon={<RefreshCw size={16} />} onClick={load} loading={loading}>刷新</Button>
          <Button icon={<Share2 size={16} />} onClick={shareLink} disabled={!matchDay}>分享链接</Button>
          <Button type="primary" icon={<Download size={16} />} onClick={downloadImage} loading={exporting} disabled={!matchDay}>
            下载高清图片
          </Button>
        </div>
      </section>

      {loadError ? <Alert type="error" showIcon message="无法查看战报" description={loadError} /> : null}

      <Spin spinning={loading}>
        {!matchDay && !loadError ? (
          <div className="public-share-empty"><Empty description="正在加载赛后战报" /></div>
        ) : matchDay?.type !== "INTERNAL" ? (
          <div className="public-share-empty"><Empty description="队外赛暂不生成三队战报" /></div>
        ) : matchDay ? (
          <>
            <div className="public-share-meta">
              <Tag color="blue">{matchDay.season?.name ?? "队内赛"}</Tag>
              <span>{matchDay.date.slice(0, 10)}</span>
              <span>点击“下载高清图片”即可保存分享</span>
            </div>

            <div className="share-shot-wrap">
              <div className="share-card" ref={cardRef}>
                <div className="share-brand-header">
                  <div className="share-brand-mark"><Trophy size={24} /></div>
                  <div><strong>灵眸GPU</strong><span>FOOTBALL CLUB · MATCH REPORT</span></div>
                </div>
                <div className="share-title">
                  <div><span>队内赛</span><strong>赛后战报</strong></div>
                  <time>{matchDay.date.slice(0, 10)}</time>
                </div>
                <table className="match-share-table">
                  <thead>
                    <tr>
                      <th className="share-section-head">节次</th>
                      {teams.map((team) => <th className={teamClassNames[team]} colSpan={2} key={team}>{teamLabels[team]}队</th>)}
                    </tr>
                    <tr>
                      <th className="share-section-head" />
                      {teams.map((team) => <FragmentHeader key={team} />)}
                    </tr>
                  </thead>
                  <tbody>
                    {matchDay.internalGames.map((game) => (
                      <tr key={game.id}>
                        <th>第{game.sectionNo}节</th>
                        {teams.map((team) => (
                          <FragmentCells
                            key={game.id + "-" + team}
                            goals={goalsText(game, team, matchDay.goalEvents)}
                            assists={assistsText(game, team, matchDay.goalEvents)}
                            highlight={teamScore(game, team) !== null && teamScore(game, team) !== 0}
                          />
                        ))}
                      </tr>
                    ))}
                    <tr className="share-points-row">
                      <th>积分</th>
                      {teams.map((team) => {
                        const points = resultPoints.get(team) ?? 0;
                        return <td colSpan={2} key={team} className={points === leaderPoints ? "share-leading-points" : undefined}>{points}</td>;
                      })}
                    </tr>
                  </tbody>
                </table>
                <div className="share-footer-note">
                  {matchDay.goalEvents.some((event) => event.kind === "OWN_GOAL") ? "乌龙球计入得分队比分，不计个人进球和助攻。" : ""}
                  数据由灵眸GPU球队数据中心生成
                </div>
              </div>
            </div>
          </>
        ) : null}
      </Spin>
    </main>
  );
}

function FragmentHeader() {
  return <><th>进球</th><th>助攻</th></>;
}

function FragmentCells({ goals, assists, highlight }: { goals: string; assists: string; highlight: boolean }) {
  return <><td className={highlight ? "share-goal-highlight" : undefined}>{goals}</td><td>{assists}</td></>;
}
