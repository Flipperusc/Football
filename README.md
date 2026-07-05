# Football Team Stats

足球队赛季数据统计系统 P0。系统用于维护球员名单、赛季、队内赛/队外赛比赛日、AI 赛后文本解析、人工确认入库，以及按数据库事件重新计算赛季榜单。

## 技术栈

- Next.js App Router + React + TypeScript
- Ant Design
- PostgreSQL + Prisma
- Zod
- DeepSeek API 服务端解析
- Vitest

## 本地启动

1. 安装依赖

```bash
pnpm install
pnpm approve-builds --all
pnpm prisma:generate
```

2. 配置环境变量

复制 `.env.example` 为 `.env`，修改数据库地址和 DeepSeek Key：

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/football_team?schema=public"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_MODEL="deepseek-v4-flash"
```

`DEEPSEEK_API_KEY` 只能放在服务端环境变量里，前端不会直接调用 DeepSeek。

3. 初始化数据库

```bash
pnpm prisma:migrate
```

4. 启动开发服务器

```bash
pnpm dev
```

默认访问 `http://localhost:3000`。

## 数据模型

Prisma schema 位于 `prisma/schema.prisma`，迁移文件位于 `prisma/migrations/20260704000000_init/migration.sql`。

核心模型包括：

- `Player` / `PlayerAlias`
- `Season`
- `MatchDay`
- `TeamAssignment`
- `InternalGame`
- `GoalEvent`
- `TeamMatchdayResult`
- `PlayerMatchdayPoint`
- `Award`
- `MatchParseResult`

统计结果不写死在前端，榜单通过 `TeamAssignment`、`InternalGame`、`GoalEvent`、`PlayerMatchdayPoint`、`Award` 重新计算。

## 主要流程

1. 在“赛季管理”创建一个赛季，例如 7 月 1 日到 10 月 1 日。
2. 在“球员管理”创建球员，并维护别名、简称、错别字候选。
3. 在“队内赛录入”录入红队、蓝队、白队阵容和赛后文本。
4. 点击“保存并解析”，服务端调用 DeepSeek 解析 JSON。
5. 在“AI 解析确认”页面检查比分、进球、助攻、球员匹配、低置信度和 `uncertainItems`。
6. 必要时编辑 JSON，或把某个 `rawName` 保存为球员别名。
7. 点击“确认入库”，后端事务写入正式比赛数据。
8. 在“榜单”查看射手榜、助攻榜、出勤榜、队内积分榜、场均榜。
9. 在球员详情页查看单人赛季数据和比赛记录。

## AI 解析

服务端模块位于 `lib/ai/deepseek.ts`。

解析要求：

- Prompt 会包含球员名单、别名、错别字候选和阵容。
- 返回值必须是 JSON。
- Zod schema 位于 `lib/ai/schemas.ts`。
- JSON 非法时最多重试 1 次。
- 低置信度和无法确认的信息进入 `needsReview` 或 `uncertainItems`。
- AI 只负责结构化解析，不负责最终榜单计算。

如果本地没有 `DEEPSEEK_API_KEY`，系统会使用 `lib/ai/local-parser.ts` 的规则解析器，方便完成开发验收流程。正式部署时应配置 DeepSeek Key。

## API

球员：

- `GET /api/players`
- `POST /api/players`
- `GET /api/players/:id`
- `PATCH /api/players/:id`
- `POST /api/players/:id/aliases`

赛季：

- `GET /api/seasons`
- `POST /api/seasons`
- `GET /api/seasons/:id`
- `PATCH /api/seasons/:id`

比赛日：

- `GET /api/matchdays`
- `POST /api/matchdays`
- `GET /api/matchdays/:id`
- `PATCH /api/matchdays/:id`
- `POST /api/matchdays/:id/parse`
- `POST /api/matchdays/:id/confirm`

统计：

- `GET /api/stats/season/:seasonId`
- `GET /api/stats/season/:seasonId/players`
- `GET /api/stats/season/:seasonId/player/:playerId`
- `GET /api/stats/season/:seasonId/rankings`

## 测试与验证

统计纯函数位于 `lib/stats/calculate.ts`，测试位于 `tests/stats.test.ts`。

```bash
pnpm test
pnpm build
```

当前已覆盖：

- 单节胜平负积分
- 队内赛小节总积分和排名
- 队伍排名对应个人赛季积分分配
- 额外加分
- 进球、助攻、出勤和场均统计

## 部署注意

- 生产环境必须配置 PostgreSQL `DATABASE_URL`。
- 生产环境应配置 `DEEPSEEK_API_KEY`。
- 数据库迁移通过 `pnpm prisma:migrate` 执行。
- 不要把 `.env` 提交到仓库。
