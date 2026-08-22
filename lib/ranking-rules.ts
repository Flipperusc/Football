export type RankingRuleScope = "all" | "internal" | "external";

export type RankingRuleDefinition = {
  key: string;
  title: string;
  description: string;
  calculation: string;
  eligibility: string;
  sorting: string;
  tieBreak: string;
  notes: string[];
};

export type RankingRuleGroup = {
  scope: RankingRuleScope;
  label: string;
  rules: RankingRuleDefinition[];
};

export const defaultRankingRuleScope: RankingRuleScope = "internal";
export const defaultRankingRuleKey = "internal-points";

const commonNotes = [
  "只统计当前所选赛季中已经确认入库的比赛事件。",
  "后台人工加减或直接设置的数据会计入对应统计结果。",
  "榜单数据会在页面加载时根据数据库事件重新计算。"
];

function standardRule(
  input: Omit<RankingRuleDefinition, "sorting" | "tieBreak" | "notes"> & { notes?: string[] }
) {
  return {
    ...input,
    sorting: "按榜单指标从高到低排列。",
    tieBreak: "指标相同时，先比较总出勤次数，总出勤更多者靠前；仍相同时按球员姓名升序排列。",
    notes: [...commonNotes, ...(input.notes ?? [])]
  } satisfies RankingRuleDefinition;
}

export const rankingRuleGroups: RankingRuleGroup[] = [
  {
    scope: "all",
    label: "总数据",
    rules: [
      standardRule({
        key: "all-goals",
        title: "总射手榜",
        description: "比较球员在全部比赛中的进球总数。",
        calculation: "总进球 = 队内赛进球 + 队外赛进球。一次事件中的进球数量按事件记录的 count 累加。",
        eligibility: "总进球大于 0 的球员进入榜单。",
        notes: ["队内赛和队外赛进球采用相同权重。"]
      }),
      standardRule({
        key: "all-assists",
        title: "总助攻榜",
        description: "比较球员在全部比赛中的助攻总数。",
        calculation: "总助攻 = 队内赛助攻 + 队外赛助攻。一次事件中的助攻数量与该进球事件的 count 一致。",
        eligibility: "总助攻大于 0 的球员进入榜单。"
      }),
      standardRule({
        key: "all-appearances",
        title: "总出勤榜",
        description: "比较球员在全部已确认比赛中的出勤次数。",
        calculation: "总出勤 = 队内赛出勤 + 队外赛出勤。同一比赛日同一球员最多计 1 次出勤。",
        eligibility: "总出勤大于 0 的球员进入榜单。",
        notes: ["队内赛按当天红、蓝、白阵容统计；队外赛按当天队外赛阵容统计。"]
      }),
      standardRule({
        key: "all-goals-rate",
        title: "场均进球",
        description: "比较球员每次出勤平均取得的进球数。",
        calculation: "场均进球 = 总进球 ÷ 总出勤，展示到小数点后 2 位；总出勤为 0 时结果按 0 处理。",
        eligibility: "场均进球大于 0 的球员进入榜单。"
      })
    ]
  },
  {
    scope: "internal",
    label: "队内赛",
    rules: [
      standardRule({
        key: "internal-points",
        title: "队内积分榜",
        description: "比较球员在队内赛中累计获得的个人赛季积分。",
        calculation: "每小节胜 3 分、平 1 分、负 0 分；三队按小节积分、净胜球、相互战绩依次确定名次，无法区分时人工确认。当天第一、第二、第三名队伍的出勤球员分别获得 3、2、1 基础分，再累计有效额外加减分和后台人工调整。",
        eligibility: "队内积分大于 0 的球员进入榜单。",
        notes: ["最佳后卫奖项次数单独统计，不重复计入队内积分。", "队外赛不产生队内积分。"]
      }),
      {
        key: "internal-goalkeepers",
        title: "门将榜",
        description: "比较当前登记位置为门将的球员在队内赛中的表现。",
        calculation: "主要指标为球员的队内积分，并同时展示队内出勤、进球、助攻和场均积分。",
        eligibility: "球员当前位置去除首尾空格后必须严格等于“门将”；即使积分为 0 也会进入榜单。",
        sorting: "先按队内积分从高到低排列，再按队内出勤次数从高到低排列。",
        tieBreak: "队内积分和队内出勤都相同时，按球员姓名升序排列。",
        notes: [...commonNotes, "门将身份以当前球员资料中的位置为准，不回溯历史比赛位置。"]
      },
      standardRule({
        key: "internal-goals",
        title: "队内射手榜",
        description: "比较球员在队内赛中的进球总数。",
        calculation: "累计已确认队内赛进球事件中的 count。",
        eligibility: "队内赛进球大于 0 的球员进入榜单。"
      }),
      standardRule({
        key: "internal-assists",
        title: "队内助攻榜",
        description: "比较球员在队内赛中的助攻总数。",
        calculation: "累计已确认队内赛中由该球员完成助攻的进球事件 count。",
        eligibility: "队内赛助攻大于 0 的球员进入榜单。"
      }),
      standardRule({
        key: "internal-appearances",
        title: "队内出勤榜",
        description: "比较球员参加队内赛的比赛日数量。",
        calculation: "球员出现在某个已确认队内赛比赛日的红、蓝或白队阵容中，该比赛日计 1 次出勤。",
        eligibility: "队内赛出勤大于 0 的球员进入榜单。"
      }),
      standardRule({
        key: "best-defenders",
        title: "最佳后卫榜",
        description: "比较球员获得最佳后卫奖项的次数。",
        calculation: "每条名称被识别为“最佳后卫”的已确认奖项记录计 1 次。",
        eligibility: "最佳后卫次数大于 0 的球员进入榜单。",
        notes: ["最佳后卫次数独立展示，不重复增加队内积分。"]
      }),
      standardRule({
        key: "internal-points-rate",
        title: "场均积分",
        description: "比较球员每次队内赛出勤平均获得的积分。",
        calculation: "场均积分 = 队内积分 ÷ 队内出勤，展示到小数点后 2 位；队内出勤为 0 时结果按 0 处理。",
        eligibility: "场均积分大于 0 的球员进入榜单。"
      }),
      standardRule({
        key: "internal-goals-rate",
        title: "队内场均进球",
        description: "比较球员每次队内赛出勤平均取得的进球数。",
        calculation: "队内场均进球 = 队内进球 ÷ 队内出勤，展示到小数点后 2 位；队内出勤为 0 时结果按 0 处理。",
        eligibility: "队内场均进球大于 0 的球员进入榜单。"
      })
    ]
  },
  {
    scope: "external",
    label: "队外赛",
    rules: [
      standardRule({
        key: "external-goals",
        title: "队外射手榜",
        description: "比较球员在队外赛中的进球总数。",
        calculation: "累计已确认队外赛进球事件中的 count。",
        eligibility: "队外赛进球大于 0 的球员进入榜单。",
        notes: ["队外赛进球不会影响队内积分。"]
      }),
      standardRule({
        key: "external-assists",
        title: "队外助攻榜",
        description: "比较球员在队外赛中的助攻总数。",
        calculation: "累计已确认队外赛中由该球员完成助攻的进球事件 count。",
        eligibility: "队外赛助攻大于 0 的球员进入榜单。"
      }),
      standardRule({
        key: "external-appearances",
        title: "队外出勤榜",
        description: "比较球员参加队外赛的比赛日数量。",
        calculation: "球员出现在某个已确认队外赛比赛日的阵容中，该比赛日计 1 次出勤。",
        eligibility: "队外赛出勤大于 0 的球员进入榜单。",
        notes: ["队外赛出勤不会产生队内积分。"]
      })
    ]
  }
];

export function getRankingRuleGroup(scope: RankingRuleScope) {
  return rankingRuleGroups.find((group) => group.scope === scope) ?? rankingRuleGroups[0];
}

export function getRankingRule(key: string) {
  return rankingRuleGroups.flatMap((group) => group.rules).find((rule) => rule.key === key);
}
