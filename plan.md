你是一个资深全栈开发工程师，请帮我开发一个足球队数据统计系统的 P0 版本。

请先检查当前代码仓库结构。如果仓库已有技术栈，请优先沿用现有技术栈；如果是空项目或结构不完整，请使用以下推荐技术栈：

- 前端：Next.js + React + TypeScript
- UI：Ant Design 或 shadcn/ui，优先选择更容易快速开发管理后台的方案
- 后端：Next.js API Routes 或独立 Node.js 后端，优先保持项目简单
- 数据库：PostgreSQL
- ORM：Prisma
- 数据校验：Zod
- AI 解析：DeepSeek API，API Key 只能放在服务端环境变量中，不能暴露到前端

## 一、项目目标

开发一个足球队数据统计系统，用于记录球队每周比赛数据，并按赛季统计每名球员的数据。

P0 版本核心目标：

1. 管理球员名单
2. 管理赛季
3. 管理每次队内赛、队外赛
4. 支持输入自然语言赛后数据
5. 调用 AI 将赛后文本解析成结构化数据
6. 根据球队名单表进行姓名识别、别名识别、错别字匹配
7. 人工确认 AI 解析结果
8. 保存正式比赛数据
9. 自动统计球员进球、助攻、出勤、赛季积分、场均数据
10. 前端页面展示榜单和球员详情

重要原则：

- AI 只负责“识别和结构化解析赛后文本”
- 后端程序负责“确定性统计”
- 不要让 AI 直接生成最终榜单
- 所有统计结果必须能根据数据库中的比赛事件重新计算
- 原始赛后文本、AI 解析结果、人工确认后的正式结果都要保留

## 二、赛季规则

一个赛季为 3 个月。

例如：

- 本赛季开始日期：7 月 1 日
- 本赛季结束日期：10 月 1 日

赛季表需要支持：

- 赛季名称
- 开始日期
- 结束日期
- 状态：进行中 / 已结束

注意：

- 不要把赛季写死为半年
- 赛季长度应由 startDate 和 endDate 决定
- 前端创建赛季时可以默认填充 3 个月周期，但数据库设计不能限制死

## 三、比赛类型

球队每周有两种比赛：

1. 队内赛 internal
2. 队外赛 external

两种比赛的数据需要分开统计。

## 四、队内赛规则

队内赛分为三队：

- 红队 red
- 蓝队 blue
- 白队 white

每队一般是：

- 7 名普通球员
- 1 名门将

每周的队伍人员不是固定的，而是根据当天报名表和分队表确定。

队内赛每次共 6 节，每节 20 分钟。

三队之间互相各踢两场：

1. 白队 vs 蓝队
2. 白队 vs 红队
3. 红队 vs 蓝队
4. 白队 vs 蓝队
5. 白队 vs 红队
6. 红队 vs 蓝队

每一节根据比分计算小节积分：

- 胜：3 分
- 平：1 分
- 负：0 分

6 节结束后，统计三队当天总分。

当天三队排名后，给该队当天出勤球员增加个人赛季积分：

- 第一名队伍：该队每名球员赛季积分 +3
- 第二名队伍：该队每名球员赛季积分 +2
- 第三名队伍：该队每名球员赛季积分 +1

如果出现同分，P0 阶段按以下规则排序：

1. 队伍总积分
2. 净胜球
3. 相互战绩
4. 如果仍无法判断，则标记为需要人工确认

队内赛还需要统计：

- 个人进球数
- 个人助攻数
- 队内赛出勤次数
- 队内赛赛季积分
- 队内赛场均进球
- 队内赛场均助攻
- 队内赛场均积分

队内赛出勤定义：

只要该球员出现在当天阵容表中，就算 1 次队内赛出勤。

## 五、队外赛规则

队外赛不统计积分。

队外赛只统计：

- 个人进球数
- 个人助攻数
- 队外赛出勤次数

队外赛出勤定义：

只要该球员出现在当天队外赛出勤名单中，就算 1 次队外赛出勤。

## 六、总数据统计

球员个人赛季总数据包括：

- 队内赛进球数
- 队内赛助攻数
- 队内赛出勤次数
- 队内赛赛季积分
- 队外赛进球数
- 队外赛助攻数
- 队外赛出勤次数
- 总进球数
- 总助攻数
- 总出勤次数
- 单位场次进球：总进球数 / 总出勤次数
- 单位场次助攻：总助攻数 / 总出勤次数
- 单位场次得分：队内赛赛季积分 / 队内赛出勤次数

注意：

- 队外赛不参与赛季积分
- 队内赛和队外赛数据需要能分别查看
- 总榜单也需要能查看

## 七、球员名单和姓名识别要求

系统中需要维护一份球队名单表。

球员表至少包含：

- id
- 标准姓名 name
- 别名 aliases
- 常见错别字 typoAliases

AI 解析赛后数据时，我会给你一份球队名单表。AI 需要根据球队名单识别文本中的球员名字。

要求：

1. 赛后文本中可能出现外号、简称、错别字
2. AI 需要尽可能匹配到球员表中的标准球员
3. 解析结果中必须保留原文名称 rawName
4. 解析结果中必须返回匹配到的 playerId
5. 如果不能确定，必须放入 uncertainItems
6. 如果多个球员都可能匹配，必须返回候选项 candidates
7. 低置信度结果不能直接入库，需要人工确认
8. 人工确认后，需要支持把这个原文名称保存为该球员的新别名

例如：

赛后文本里出现：

“欧巴助攻雪子”

如果球队名单中有：

- playerId: p001, name: 欧巴, aliases: ["欧巴"]
- playerId: p002, name: 雪子, aliases: ["雪子"]

则 AI 应解析为：

- 助攻人：欧巴，对应 p001
- 进球人：雪子，对应 p002

如果出现错别字或近似名称，例如：

“雪仔”“雪子哥”“欧吧”

AI 应该尝试匹配到最可能的标准球员，并给出 confidence。

## 八、赛后文本示例

队内赛赛后文本示例：

第一节白蓝1：0陶陶助攻刘旭
第二节白红1：2十三助攻雪子欧巴助攻雪子，雷州助攻王龙
第三节红蓝 1：1十三进球，俊锟助攻曾琦
第四节白蓝1：2陶陶进球 董事长助攻宇哥 俊锟助攻宇哥梅开二度
第五节白红0：0
第六节红蓝0:0
最佳后卫欧巴果子林，红队队长果子林加一分

AI 需要解析出：

1. 每一节的队伍
2. 每一节比分
3. 每个进球事件
4. 每个助攻事件
5. 哪个球员进球
6. 哪个球员助攻
7. 哪个队进球
8. 特殊备注，例如最佳后卫、队长加一分
9. 无法确认的信息

注意：

“俊锟助攻宇哥梅开二度”表示宇哥进了两个球，其中至少一个球由俊锟助攻。由于文本没有明确两个球是否都是俊锟助攻，应将该项标记为 uncertainItems，让人工确认。

“十三进球”表示只有进球，没有助攻。

“白蓝1：0陶陶助攻刘旭”通常表示白队 1:0 蓝队，陶陶助攻刘旭进球。

## 九、AI 解析输出 JSON 要求

请设计一个稳定的 JSON Schema，并在后端用 Zod 校验。

队内赛 AI 解析结果建议结构如下：

{
"matchType": "internal",
"games": [
{
"sectionNo": 1,
"teamA": "white",
"teamB": "blue",
"scoreA": 1,
"scoreB": 0,
"events": [
{
"type": "goal",
"team": "white",
"scorer": {
"rawName": "刘旭",
"playerId": "p001",
"matchedName": "刘旭",
"confidence": 0.98,
"candidates": []
},
"assist": {
"rawName": "陶陶",
"playerId": "p002",
"matchedName": "陶陶",
"confidence": 0.98,
"candidates": []
},
"count": 1,
"rawText": "陶陶助攻刘旭",
"confidence": 0.95,
"needsReview": false
}
],
"rawText": "第一节白蓝1：0陶陶助攻刘旭"
}
],
"awards": [
{
"name": "最佳后卫",
"players": [
{
"rawName": "欧巴",
"playerId": "p003",
"matchedName": "欧巴",
"confidence": 0.98,
"candidates": []
}
],
"points": 0,
"rawText": "最佳后卫欧巴果子林"
}
],
"bonusPoints": [
{
"player": {
"rawName": "果子林",
"playerId": "p004",
"matchedName": "果子林",
"confidence": 0.98,
"candidates": []
},
"points": 1,
"reason": "红队队长加一分",
"rawText": "红队队长果子林加一分"
}
],
"uncertainItems": [
{
"rawText": "俊锟助攻宇哥梅开二度",
"reason": "无法确认宇哥两个进球是否都由俊锟助攻",
"candidates": []
}
]
}

队外赛 AI 解析结果结构类似，但不需要 sectionNo 和队内三队积分。

队外赛建议结构：

{
"matchType": "external",
"events": [
{
"type": "goal",
"scorer": {
"rawName": "刘旭",
"playerId": "p001",
"matchedName": "刘旭",
"confidence": 0.98,
"candidates": []
},
"assist": {
"rawName": "陶陶",
"playerId": "p002",
"matchedName": "陶陶",
"confidence": 0.98,
"candidates": []
},
"count": 1,
"rawText": "陶陶助攻刘旭",
"confidence": 0.95,
"needsReview": false
}
],
"uncertainItems": []
}

## 十、人工确认流程

AI 解析完成后，不要直接保存为正式比赛数据。

需要做一个确认页面：

1. 展示原始赛后文本
2. 展示 AI 解析出的每一节比分
3. 展示每个进球事件
4. 展示每个助攻事件
5. 展示每个球员的匹配结果
6. 对低置信度或 uncertainItems 高亮展示
7. 允许用户修改球员匹配
8. 允许用户修改进球、助攻、比分
9. 允许用户删除错误事件
10. 允许用户新增遗漏事件
11. 允许用户把某个 rawName 保存为球员别名
12. 点击确认后，才写入正式数据表

## 十一、数据库设计要求

请设计 Prisma Schema，至少包含以下模型：

1. Player
2. PlayerAlias
3. Season
4. MatchDay
5. TeamAssignment
6. InternalGame
7. GoalEvent
8. TeamMatchdayResult
9. PlayerMatchdayPoint
10. Award
11. ParseJob 或 MatchParseResult

建议字段：

Player:

- id
- name
- jerseyNumber
- position
- status
- createdAt
- updatedAt

PlayerAlias:

- id
- playerId
- alias
- aliasType: nickname / typo / shortName / manual
- createdAt

Season:

- id
- name
- startDate
- endDate
- status
- createdAt
- updatedAt

MatchDay:

- id
- seasonId
- date
- type: internal / external
- rawText
- parseStatus: pending / parsed / confirmed / failed
- confirmedAt
- createdAt
- updatedAt

TeamAssignment:

- id
- matchDayId
- teamColor: red / blue / white / external
- playerId
- role: player / goalkeeper
- isCaptain

InternalGame:

- id
- matchDayId
- sectionNo
- teamA
- teamB
- scoreA
- scoreB
- rawText

GoalEvent:

- id
- matchDayId
- internalGameId，可为空，队外赛为空
- matchType: internal / external
- teamColor，可为空
- scorerId
- assistPlayerId，可为空
- count，默认为 1
- rawText
- needsReview

TeamMatchdayResult:

- id
- matchDayId
- teamColor
- matchPoints
- goalsFor
- goalsAgainst
- goalDifference
- rank
- seasonPointsAwarded

PlayerMatchdayPoint:

- id
- matchDayId
- playerId
- basePoints
- bonusPoints
- totalPoints
- reason

Award:

- id
- matchDayId
- name
- playerId
- points
- note
- rawText

MatchParseResult:

- id
- matchDayId
- rawText
- parsedJson
- modelName
- status
- errorMessage
- createdAt

## 十二、后端 API 要求

请实现以下 API：

球员管理：

- GET /api/players
- POST /api/players
- PATCH /api/players/
- POST /api/players//aliases

赛季管理：

- GET /api/seasons
- POST /api/seasons
- PATCH /api/seasons/

比赛管理：

- GET /api/matchdays
- POST /api/matchdays
- GET /api/matchdays/
- POST /api/matchdays//parse
- POST /api/matchdays//confirm
- PATCH /api/matchdays/

统计榜单：

- GET /api/stats/season/
- GET /api/stats/season//players
- GET /api/stats/season//player/
- GET /api/stats/season//rankings

## 十三、统计逻辑要求

请写纯函数实现统计逻辑，并添加测试。

必须包含：

1. 单节胜平负积分计算
2. 队内赛 6 节总积分计算
3. 队伍排名计算
4. 每个队伍对应的个人赛季积分分配
5. 额外加分计算
6. 球员进球统计
7. 球员助攻统计
8. 出勤统计
9. 场均数据计算

请避免把统计结果写死。

统计结果应可以通过数据库中的：

- TeamAssignment
- InternalGame
- GoalEvent
- PlayerMatchdayPoint
- Award

重新计算出来。

## 十四、前端页面要求

P0 需要实现以下页面：

1. 球员管理页
   - 新增球员
   - 编辑球员
   - 维护别名
   - 查看球员列表
2. 赛季管理页
   - 创建赛季
   - 查看赛季
   - 当前赛季标记
   - 默认支持 3 个月赛季
3. 队内赛录入页
   - 选择赛季
   - 选择日期
   - 填写红队、蓝队、白队阵容
   - 填写每队球员和门将
   - 输入赛后文本
   - 点击 AI 解析
   - 跳转或展示确认页面
4. 队外赛录入页
   - 选择赛季
   - 选择日期
   - 填写出勤名单
   - 输入赛后文本
   - 点击 AI 解析
   - 人工确认
5. AI 解析确认页
   - 原始文本
   - 结构化结果
   - 球员匹配结果
   - 低置信度提醒
   - uncertainItems 提醒
   - 可编辑比分、进球、助攻、球员匹配
   - 支持保存 rawName 为球员别名
   - 确认后入库
6. 赛季榜单页
   - 总射手榜
   - 总助攻榜
   - 总出勤榜
   - 队内赛积分榜
   - 场均进球榜
   - 场均得分榜
   - 可切换队内赛 / 队外赛 / 总数据
7. 球员详情页
   - 球员基础信息
   - 本赛季数据
   - 历史赛季数据
   - 参加过的比赛记录
   - 进球和助攻明细

## 十五、DeepSeek API 要求

请封装一个服务端 AI 解析模块。

要求：

1. API Key 从环境变量读取
2. 前端不能直接调用 DeepSeek
3. 后端接口接收 rawText、matchType、players、teamAssignments
4. Prompt 中必须包含球队名单、别名、错别字候选
5. 返回 JSON
6. 用 Zod 校验返回 JSON
7. JSON 不合法时，最多重试 1 次
8. 解析失败时返回明确错误信息
9. 低置信度匹配进入 needsReview
10. uncertainItems 必须展示给用户

AI Prompt 需要强调：

- 你是足球赛后数据结构化解析器
- 只能返回 JSON
- 不要编造不存在的球员
- 必须基于给定球队名单匹配球员
- 保留 rawName
- 返回 playerId
- 如果不确定，进入 uncertainItems
- 如果出现错别字、简称、外号，尝试匹配 aliases 和 typoAliases
- 不要计算最终榜单
- 不要跳过无法确认的信息

## 十六、工程质量要求

请完成以下内容：

1. 设计数据库 schema
2. 完成 Prisma migration
3. 实现核心 API
4. 实现 AI 解析服务
5. 实现统计服务
6. 实现前端 P0 页面
7. 添加必要的类型定义
8. 添加 Zod schema
9. 添加基础测试，尤其是统计逻辑测试
10. 添加 README，说明如何启动项目、配置数据库、配置 DeepSeek API Key

## 十七、开发顺序建议

请按以下顺序开发：

1. 检查现有项目结构
2. 确定技术栈
3. 建立数据库模型
4. 实现球员、别名、赛季基础 CRUD
5. 实现比赛日创建
6. 实现队内赛阵容录入
7. 实现 AI 解析接口
8. 实现解析确认页面
9. 实现确认后入库
10. 实现统计服务
11. 实现榜单页面
12. 实现球员详情页
13. 添加测试和 README

## 十八、验收标准

完成后，系统至少应该能跑通以下流程：

1. 创建一个赛季：7 月 1 日到 10 月 1 日
2. 创建球员名单，并为球员添加别名
3. 创建一次队内赛
4. 录入红队、蓝队、白队阵容
5. 输入以下赛后文本：

第一节白蓝1：0陶陶助攻刘旭
第二节白红1：2十三助攻雪子欧巴助攻雪子，雷州助攻王龙
第三节红蓝 1：1十三进球，俊锟助攻曾琦
第四节白蓝1：2陶陶进球 董事长助攻宇哥 俊锟助攻宇哥梅开二度
第五节白红0：0
第六节红蓝0:0
最佳后卫欧巴果子林，红队队长果子林加一分

1. AI 能解析比分、进球、助攻、奖励、加分、模糊项
2. 系统能识别别名和错别字，并匹配到球员 ID
3. 用户可以人工修改解析结果
4. 用户确认后，系统保存正式比赛数据
5. 系统自动计算队内赛三队积分
6. 系统自动给对应队员增加赛季积分
7. 系统自动统计个人进球、助攻、出勤、场均数据
8. 榜单页面能正确展示结果

请在实现过程中优先保证数据模型清晰、统计逻辑可靠、AI 解析结果可人工确认。不要只做静态页面，也不要把统计逻辑写在前端。