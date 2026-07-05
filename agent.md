# Agent Guide

每次在本项目开始新对话或新任务前，先阅读本文件，再按任务需要阅读 `README.md`、`plan.md` 和相关源码。不要只依赖历史对话记忆。

## 项目概览

这是一个足球队赛季数据统计系统 P0，核心目标是维护球员、赛季、队内赛/队外赛比赛日，使用 AI 解析赛后自然语言文本，经过人工确认后写入正式比赛事件，并从数据库事件重新计算榜单。

技术栈：

- Next.js 14 App Router + React 18 + TypeScript strict mode
- Ant Design 5 + lucide-react
- PostgreSQL + Prisma 5
- Zod 校验
- DeepSeek 服务端解析，缺少 `DEEPSEEK_API_KEY` 时使用本地规则 fallback
- Vitest

## 启动与验证

常用命令：

```bash
pnpm install
pnpm approve-builds --all
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev
pnpm test
pnpm build
```

Windows 快速启动入口是 `start.bat`，实际逻辑在 `scripts/start-dev.ps1`。脚本会设置 `.tmp` 为临时目录，按需复制 `.env.example`，生成 Prisma Client，执行 `prisma migrate deploy`，再启动 Next dev server。

环境变量：

- `DATABASE_URL` 指向 PostgreSQL，生产和本地运行 API 都需要。
- `DEEPSEEK_API_KEY` 只能在服务端环境变量中使用，不能暴露到前端。
- `DEEPSEEK_MODEL` 默认是 `deepseek-v4-flash`。
- `.env` 被 `.gitignore` 忽略，不要在响应或文档里泄露其中的真实值。

## 代码地图

- `app/`：Next App Router 页面与 API。
- `app/page.tsx`：控制台。
- `app/players/page.tsx`：球员管理和批量导入。
- `app/players/[id]/page.tsx`：球员详情。
- `app/seasons/page.tsx`：赛季管理。
- `app/matchdays/internal/page.tsx`、`app/matchdays/external/page.tsx`：比赛录入。
- `app/matchdays/[id]/confirm/page.tsx`：AI 解析确认、编辑、保存别名、确认入库。
- `app/rankings/page.tsx`：赛季榜单。
- `components/AppShell.tsx`：侧边栏布局。
- `components/MatchEntryForm.tsx`：队内/队外比赛录入表单。
- `components/PlayerBulkImport.tsx`：粘贴名单、识别、批量导入球员。
- `lib/ai/`：DeepSeek 调用、JSON 清洗、本地解析器、球员名单解析、阵容解析、AI 输出 schema。
- `lib/server/confirm-matchday.ts`：确认入库事务，删除旧正式数据后重建事件、积分、奖励。
- `lib/server/stats.ts`：从数据库加载已确认比赛并调用纯统计函数。
- `lib/stats/calculate.ts`：统计纯函数，测试优先维护这里。
- `lib/validations.ts`：API 请求 Zod schema。
- `prisma/schema.prisma`：数据库模型。
- `tests/`：统计、赛后解析、球员名单、阵容识别测试。

PowerShell 注意：Next 动态路由目录包含方括号，例如 `app/api/matchdays/[id]/route.ts`。读取这类路径时用 `-LiteralPath`，否则方括号会被当作通配符。

## 领域规则

赛季：

- 赛季长度由 `startDate` 和 `endDate` 决定。
- 前端默认可填 3 个月，但数据库不能把赛季写死为固定长度。

比赛类型：

- `INTERNAL` 队内赛：红队、蓝队、白队。
- `EXTERNAL` 队外赛：只统计进球、助攻、出勤，不参与队内赛季积分。

队内赛：

- 每次 6 节，赛程顺序是白蓝、白红、红蓝、白蓝、白红、红蓝。
- 单节胜 3 分，平 1 分，负 0 分。
- 当天队伍排名后，该队出勤球员获得个人赛季积分：第一名 +3，第二名 +2，第三名 +1。
- 同分排序：总积分、净胜球、相互战绩；仍无法判断时标记人工确认。
- 队内赛出勤按当天阵容表计算。

队外赛：

- 出勤按当天队外赛出勤名单计算。
- 不生成队伍排名积分和个人队内赛季积分。

统计原则：

- AI 不计算最终榜单。
- 榜单必须由数据库中的 `TeamAssignment`、`InternalGame`、`GoalEvent`、`PlayerMatchdayPoint`、`Award` 等事件重新计算。
- 不要把统计逻辑写在前端页面里。

## AI 与确认流程

DeepSeek 只负责把赛后文本、球员名单、别名、错别字候选和阵容转换为结构化事实。后端负责：

- 抽取/清洗 AI JSON。
- 用 `lib/ai/schemas.ts` 的 Zod schema 校验。
- 匹配 `playerId`、计算置信度和 candidates。
- 将低置信度或无法确定的信息放进 `needsReview` / `uncertainItems`。
- 本地没有 `DEEPSEEK_API_KEY` 或调用失败时，使用本地规则解析器保持开发流程可跑通。

确认入库流程：

- `/api/matchdays/[id]/parse` 保存最新解析结果，比赛日状态变为 `PARSED`。
- `/matchdays/[id]/confirm` 允许编辑比分、进球、助攻、球员匹配、额外加分，并可把 `rawName` 保存为别名。
- `/api/matchdays/[id]/confirm` 调用 `confirmMatchDay`，校验没有未匹配进球/加分球员后，在事务内重建正式数据，并把比赛日状态置为 `CONFIRMED`。

修改 AI 输出结构时，必须同时检查：

- `lib/ai/schemas.ts`
- `lib/ai/deepseek.ts`
- `lib/ai/local-parser.ts`
- `app/matchdays/[id]/confirm/page.tsx`
- `lib/server/confirm-matchday.ts`
- 相关测试

## 数据模型重点

核心 Prisma 模型：

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

重要约束：

- `TeamAssignment` 对同一比赛日和球员唯一。
- `InternalGame` 对同一比赛日和节次唯一。
- `PlayerAlias` 对同一球员和 alias 唯一。
- 删除确认数据时要按现有事务模式清理 `GoalEvent`、`PlayerMatchdayPoint`、`TeamMatchdayResult`、`Award`、`InternalGame`，不要留下过期正式数据。

## 开发约束

- 沿用现有 TypeScript、Ant Design、Zod、Prisma、App Router 风格。
- API 接收外部输入时先用 `lib/validations.ts` 或 AI schema 校验。
- 新统计规则优先写在 `lib/stats/calculate.ts`，并加 Vitest。
- 涉及数据库读取聚合时，保持 `lib/server/stats.ts` 只负责装配数据，避免把算法分散到 API route 或页面中。
- 前端页面保持管理后台风格：信息密集、可扫描、少装饰；不要做营销式首页。
- 使用 lucide-react 图标配合 Ant Design 控件。
- 不要把 DeepSeek key、数据库密码或 `.env` 内容写入代码、测试输出或文档。
- 生成目录和依赖目录包括 `node_modules`、`.next`、`.pnpm-store`、`.tmp`，通常不要手动编辑。

## 当前项目状态记录

本文件生成时已经阅读了项目文档、配置、页面、动态 API、Prisma schema、AI 模块、统计模块、确认入库逻辑、测试和启动脚本；未把 `node_modules`、`.next`、`.pnpm-store`、`.tmp` 当作源码阅读。

当前工作区有一个空的 `.git` 目录，`git status` 报 `not a git repository`。如果后续任务需要提交、diff 或回滚，先重新核对 Git 状态，不要假设版本控制可用。

当前环境里 `rg.exe` 被拒绝执行；需要搜索时可改用 PowerShell `Get-ChildItem` / `Select-String`。如果读取动态路由文件，记得使用 `-LiteralPath`。

## 任务前检查清单

1. 先读本文件。
2. 若任务涉及产品需求，读 `README.md` 和 `plan.md`。
3. 若任务涉及页面，读对应 `app/.../page.tsx` 和相关 `components/`。
4. 若任务涉及 API，读对应 `app/api/.../route.ts`、`lib/validations.ts` 和相关 `lib/server/`。
5. 若任务涉及 AI 解析，读 `lib/ai/schemas.ts`、`lib/ai/deepseek.ts`、`lib/ai/local-parser.ts`、`lib/ai/player-list.ts` 或 `lib/ai/roster.ts`。
6. 若任务涉及统计，读 `lib/stats/calculate.ts`、`lib/stats/types.ts`、`lib/server/stats.ts` 和 `tests/stats.test.ts`。
7. 改完后按影响面运行 `pnpm test`，必要时运行 `pnpm build`。
