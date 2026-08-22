# Football Team Stats

**PS：本项目已上线，查看具体效果可访问https://football.flipperusc.work/**

足球队赛季数据统计系统。系统用于维护球员名单、赛季、队内赛/队外赛比赛日、AI 赛后文本解析、人工确认入库，以及按数据库事件重新计算赛季榜单。

> **从空机器启动、生产部署、迁移和故障排查请先看 [项目架构与启动指南](docs/项目架构与启动指南.md)。** 本 README 保持简短的项目入口；不要将真实数据库密码、API Key 或会话令牌写入仓库。

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
corepack prepare pnpm@9.12.3 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm prisma:generate
```

2. 配置环境变量

复制 `.env.example` 为 `.env`，填写自己的数据库地址、管理员凭据和 DeepSeek Key（下列均为占位符）：

```bash
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/football_team?schema=public"
DEEPSEEK_API_KEY="<DEEPSEEK_API_KEY_OR_EMPTY>"
DEEPSEEK_MODEL="deepseek-v4-flash"
ADMIN_USERNAME="<ADMIN_USERNAME>"
ADMIN_PASSWORD="<ADMIN_PASSWORD>"
ADMIN_SESSION_TOKEN="<LONG_RANDOM_SESSION_TOKEN>"
UPLOAD_DIR="<OPTIONAL_PERSISTENT_UPLOAD_DIRECTORY>"
```

`DEEPSEEK_API_KEY` 只能放在服务端环境变量里，前端不会直接调用 DeepSeek。
`UPLOAD_DIR` 可选；生产环境建议设置为持久目录，例如 `/var/www/football-team-stats/uploads`，并确保运行 Next.js 的用户有读写权限。

3. 初始化数据库

```bash
corepack pnpm prisma migrate deploy
```

4. 启动开发服务器

```bash
corepack pnpm dev
```

默认访问 `http://localhost:3000`。

## 数据模型

Prisma schema 位于 `prisma/schema.prisma`，完整迁移历史位于 `prisma/migrations/`；其中 `20260804000000_player_identity_uniqueness/` 为球员名称与别名唯一性迁移。

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
8. 在“榜单”查看射手榜、助攻榜、出勤榜、队内积分榜、门将榜和场均榜；门将榜按队内积分统计当前位置为“门将”的球员。
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
- `DELETE /api/players/:id/aliases/:aliasId`

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
- 数据库迁移通过 `corepack pnpm prisma migrate deploy` 执行。
- 不要把 `.env` 提交到仓库。
