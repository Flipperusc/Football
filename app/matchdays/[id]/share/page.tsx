"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Alert, Button, Empty, Spin, Tag } from "antd";
import { ArrowLeft, Camera, RefreshCw } from "lucide-react";
import { requestJson } from "@/lib/client-types";

type TeamColor = "RED" | "BLUE" | "WHITE" | "EXTERNAL";
type InternalTeamColor = Exclude<TeamColor, "EXTERNAL">;

type ShareMatchDay = {
  id: string;
  date: string;
  type: "INTERNAL" | "EXTERNAL";
  parseStatus: "PENDING" | "PARSED" | "CONFIRMED" | "FAILED";
  season?: { name: string };
  internalGames: {
    id: string;
    sectionNo: number;
    teamA: InternalTeamColor;
    teamB: InternalTeamColor;
    scoreA: number;
    scoreB: number;
  }[];
  goalEvents: {
    id: string;
    internalGameId?: string | null;
    teamColor?: TeamColor | null;
    scorerId: string;
    assistPlayerId?: string | null;
    count: number;
    scorer: { id: string; name: string };
    assistPlayer?: { id: string; name: string } | null;
  }[];
  teamResults: {
    teamColor: InternalTeamColor;
    matchPoints: number;
  }[];
};

const teams: InternalTeamColor[] = ["BLUE", "RED", "WHITE"];

const teamLabels: Record<InternalTeamColor, string> = {
  BLUE: "蓝",
  RED: "红",
  WHITE: "白"
};

const teamClassNames: Record<InternalTeamColor, string> = {
  BLUE: "share-team-blue",
  RED: "share-team-red",
  WHITE: "share-team-white"
};

function teamScore(
  game: ShareMatchDay["internalGames"][number],
  teamColor: InternalTeamColor
) {
  if (game.teamA === teamColor) return game.scoreA;
  if (game.teamB === teamColor) return game.scoreB;
  return null;
}

function mergeNameCounts(items: { name: string; count: number }[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => `${name}${count}`)
    .join("");
}

function goalsText(
  game: ShareMatchDay["internalGames"][number],
  teamColor: InternalTeamColor,
  events: ShareMatchDay["goalEvents"]
) {
  const score = teamScore(game, teamColor);
  if (score === null) return "-";

  const teamEvents = events.filter(
    (event) => event.internalGameId === game.id && event.teamColor === teamColor
  );
  const text = mergeNameCounts(
    teamEvents.map((event) => ({ name: event.scorer.name, count: event.count }))
  );

  if (text) return text;
  return score === 0 ? "0" : String(score);
}

function assistsText(
  game: ShareMatchDay["internalGames"][number],
  teamColor: InternalTeamColor,
  events: ShareMatchDay["goalEvents"]
) {
  const score = teamScore(game, teamColor);
  if (score === null) return "-";

  const text = mergeNameCounts(
    events
      .filter(
        (event) =>
          event.internalGameId === game.id &&
          event.teamColor === teamColor &&
          event.assistPlayer
      )
      .map((event) => ({ name: event.assistPlayer!.name, count: event.count }))
  );

  return text;
}

export default function MatchDaySharePage() {
  const params = useParams<{ id: string }>();
  const [matchDay, setMatchDay] = useState<ShareMatchDay>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load() {
    setLoading(true);
    try {
      setLoadError(undefined);
      setMatchDay(await requestJson<ShareMatchDay>(`/api/matchdays/${params.id}`));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载公示图数据失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  const resultPoints = useMemo(
    () =>
      new Map(
        (matchDay?.teamResults ?? []).map((result) => [result.teamColor, result.matchPoints])
      ),
    [matchDay?.teamResults]
  );

  const leaderPoints = Math.max(...Array.from(resultPoints.values()), 0);

  return (
    <>
      <div className="page-title">
        <div>
          <h1>赛后公示图</h1>
          <p>确认入库后自动生成，截图下面表格即可发到微信群公示。</p>
        </div>
        <div className="toolbar">
          <Link href="/matchdays/internal">
            <Button icon={<ArrowLeft size={16} />}>继续录入</Button>
          </Link>
          <Button icon={<RefreshCw size={16} />} onClick={load} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      {loadError ? (
        <Alert type="error" showIcon message="加载失败" description={loadError} style={{ marginBottom: 16 }} />
      ) : null}

      <Spin spinning={loading}>
        {!matchDay ? (
          <div className="section-panel">
            <Empty description="暂无比赛数据" />
          </div>
        ) : matchDay.type !== "INTERNAL" ? (
          <div className="section-panel">
            <Empty description="队外赛暂不生成蓝红白三队公示图" />
          </div>
        ) : matchDay.parseStatus !== "CONFIRMED" ? (
          <Alert
            type="warning"
            showIcon
            message="比赛尚未确认入库"
            description="请先完成 AI 解析确认，确认后这里会生成可截图公示图。"
          />
        ) : (
          <>
            <div className="section-panel share-helper">
              <Tag color="green">{matchDay.season?.name ?? "队内赛"}</Tag>
              <span>{matchDay.date.slice(0, 10)}</span>
              <span className="share-helper-note">
                <Camera size={15} />
                截图下方白色表格区域即可
              </span>
            </div>

            <div className="share-shot-wrap">
              <div className="share-card">
                <div className="share-title">
                  <strong>灵眸GPU 队内赛赛后公示</strong>
                  <span>{matchDay.date.slice(0, 10)}</span>
                </div>
                <table className="match-share-table">
                  <thead>
                    <tr>
                      <th className="share-section-head" />
                      {teams.map((team) => (
                        <th className={teamClassNames[team]} colSpan={2} key={team}>
                          {teamLabels[team]}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="share-section-head" />
                      {teams.map((team) => (
                        <FragmentHeader key={team} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matchDay.internalGames.map((game) => (
                      <tr key={game.id}>
                        <th>第{game.sectionNo}节</th>
                        {teams.map((team) => {
                          const goals = goalsText(game, team, matchDay.goalEvents);
                          const assists = assistsText(game, team, matchDay.goalEvents);
                          const didPlay = teamScore(game, team) !== null;
                          const hasGoalNames = didPlay && goals !== "0" && goals !== "-";

                          return (
                            <FragmentCells
                              key={`${game.id}-${team}`}
                              goals={goals}
                              assists={assists}
                              highlight={hasGoalNames}
                            />
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="share-points-row">
                      <th>积分</th>
                      {teams.map((team) => {
                        const points = resultPoints.get(team) ?? 0;
                        return (
                          <td
                            colSpan={2}
                            key={team}
                            className={points === leaderPoints ? "share-leading-points" : undefined}
                          >
                            {points}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Spin>
    </>
  );
}

function FragmentHeader() {
  return (
    <>
      <th>进球</th>
      <th>助攻</th>
    </>
  );
}

function FragmentCells({
  goals,
  assists,
  highlight
}: {
  goals: string;
  assists: string;
  highlight: boolean;
}) {
  return (
    <>
      <td className={highlight ? "share-goal-highlight" : undefined}>{goals}</td>
      <td>{assists}</td>
    </>
  );
}
