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
DEEPSEEK_ATTEMPT_TIMEOUT_MS="45000"
DEEPSEEK_MAX_TOKENS="4096"
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
6. 在表格中修改事件类型、得分队和球员，或把原文名字保存为球员别名。
7. 点击“确认入库”，后端事务写入正式比赛数据。
8. 在“榜单”查看射手榜、助攻榜、出勤榜、队内积分榜、门将榜和场均榜；门将榜按队内积分统计当前位置为“门将”的球员。
9. 在球员详情页查看单人赛季数据和比赛记录。

队内赛特殊事件：

- 临时代打进球或助攻，选择本节实际得分队；入库前会集中弹出二次确认。
- 乌龙球选择「乌龙球」及受益队，系统清空助攻；不计任何人的个人进球或助攻。
- 当天名单中的临时未到场者仍获得出勤和原队排名积分。代打者的出勤只算一次，基础积分也按原队计算。
- 取消确认保留表单且不修改正式数据；修改事件后须重新确认。得分队不明确时可在弹窗中补选。
- 战报和球员记录保留代打、乌龙标记；重新入库替换旧事件，不重复累计。

试训与计分资格：

- 分队识别未匹配或模糊匹配的名字列入“试训待确认”；管理员可确认试训身份，或匹配正式球员。试训区仅展示姓名及进球、助攻、乌龙对应节次。
- 试训人员不进入正式赛季榜单，但事件比分正常影响团队积分与排名；配合的正式球员进球或助攻正常计算。
- 乌龙球在独立区域录入，无助攻；正式球员详情新增独立乌龙数，普通进球统计不变。
- 正式球员均按当天原队排名正常计分，不再提供本场积分资格开关。“特殊积分与奖项”集中录入奖项和额外加分；保存新别名位于试训球员区域上方。
- 修改已确认比赛的阵容与试训身份先保留为草稿，确认成功后才替换正式记录；重新解析不会清除旧统计。
- 全局正式球员即使未进入当天分队，也可按代打录入进球和助攻。未分队者只计个人事件，不增加出勤或队伍排名积分；保存前仍须确认得分队和代打身份。
- 未识别人员会弹窗提示，可一键加入正式名单、匹配已有正式球员或保留试训。转正只转换当前比赛的事件草稿，确认入库后进入个人统计；其他历史比赛保持原样。加入全局名单立即生效，不自动补入当天分队。

## AI 解析

服务端模块位于 `lib/ai/deepseek.ts`。

解析要求：

- Prompt 会包含球员名单、别名、错别字候选和阵容。
- 返回值必须是 JSON。
- Zod schema 位于 `lib/ai/schemas.ts`。
- DeepSeek 请求显式关闭思考模式，默认 `max_tokens=4096`。
- 单次请求默认等待 45 秒；只对超时、429、5xx、空内容或非法 JSON/schema 最多重试 1 次。
- 低置信度和无法确认的信息进入 `needsReview` 或 `uncertainItems`。
- AI 只负责结构化解析，不负责最终榜单计算。

如果本地没有 `DEEPSEEK_API_KEY`，系统会使用 `lib/ai/local-parser.ts` 的规则解析器，方便完成开发验收流程。正式部署时应配置 DeepSeek Key。
一旦配置了 Key，DeepSeek 超时、鉴权、余额、限流或返回格式错误会以明确的中文错误和错误码返回，不会再静默切换规则解析。

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
pnpm test:e2e
```

当前已覆盖：

- 单节胜平负积分
- 队内赛小节总积分和排名
- 队伍排名对应个人赛季积分分配
- 额外加分
- 进球、助攻、出勤和场均统计
- 临时代打、乌龙、二次确认凭证失效、取消及重新入库

浏览器测试使用隔离数据库，不读取 `.env` 中的业务数据库地址或 DeepSeek Key。默认在 `.test-state/postgres` 启动本地 PostgreSQL（端口 55439）；Windows 默认寻找 PostgreSQL 18 和 Edge，也可用 `PG_BIN` 指定 PostgreSQL 工具目录。其他环境先执行 `pnpm exec playwright install chromium`。

已有测试库时可设置 `E2E_DATABASE_URL`，仅接受本机、名称为 `football_e2e` 或 `football_e2e_*` 的数据库。测试启动时执行迁移，结束后删除本次测试数据；只有脚本自行启动的数据库会自动停止。CI 使用独立 PostgreSQL 服务运行同样的流程。

本机资源不足时，可先执行 `corepack pnpm build`，再设置 `E2E_USE_BUILD=1` 运行端到端测试，复用生产构建减少实时编译开销。该模式在隔离测试中显式转发真实登录响应的 Cookie，以支持本机 HTTP API 请求；应用的生产 Secure Cookie 设置不变。

## 部署注意

- 生产环境必须配置 PostgreSQL `DATABASE_URL`。
- 生产环境应配置 `DEEPSEEK_API_KEY`。
- 建议设置 `DEEPSEEK_ATTEMPT_TIMEOUT_MS="45000"` 和 `DEEPSEEK_MAX_TOKENS="4096"`。
- nginx 反向代理应设置 `proxy_connect_timeout 10s`、`proxy_send_timeout 120s`、`proxy_read_timeout 120s`，确保应用约 90 秒内的重试或中文错误先返回。
- 数据库迁移通过 `corepack pnpm prisma migrate deploy` 执行。
- 名单外代打与试训转正功能需要应用 `20261025000000_off_roster_guests` 迁移，再生成 Prisma Client、构建并重启。迁移增加角色代打标记及身份处理去重记录，不重写旧比赛统计。
- 本次上线须应用全部待执行迁移，包括 `20261019000000_match_event_exceptions`、`20261021000000_trial_players_points` 和 `20261021010000_retire_points_eligibility`，再生成 Prisma Client、构建并重启应用。最后一项迁移恢复曾被取消的正式球员积分，按最后正式确认的加分和已保存奖项计算，不使用编辑草稿。历史进球性质保持不变。
- 不要把 `.env` 提交到仓库。
