# 项目上下文

后续每次在本项目开始新任务前，先阅读本文件，再根据任务需要继续阅读 `README.md`、`plan.md`、`落地步骤.md` 和相关源码。不要只依赖历史对话记忆。

## 项目简介

这是一个足球队赛季数据统计系统，项目名为 `football-team-stats`。系统用于维护球队球员、赛季、队内赛/队外赛比赛日、赛后文本解析、人工确认入库、球队风采照片，以及从数据库事件重新计算赛季榜单。

当前线上部署在腾讯云 Ubuntu 服务器，通过 nginx 反向代理到域名 `football.flipperusc.work`。项目是 Next.js 应用，通常由 Next.js 服务监听本机端口，再由 nginx 代理外部请求。

## 技术栈

- Next.js 14 App Router
- React 18
- TypeScript
- Ant Design 5
- lucide-react
- PostgreSQL
- Prisma 5
- Zod
- DeepSeek 服务端解析；只有未配置 Key 的本地开发环境使用规则 fallback，配置 Key 后调用失败返回明确错误
- Vitest
- pnpm 9

## 常用命令

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev
pnpm test
pnpm build
pnpm start
```

Windows 本地快速启动入口是 `start.bat`，实际逻辑在 `scripts/start-dev.ps1`。

## 重要环境变量

只记录变量名和用途，不要把真实值写进文档、代码、测试输出或对话总结。

- `DATABASE_URL`：PostgreSQL 连接地址。
- `DEEPSEEK_API_KEY`：DeepSeek API Key，只能在服务端使用。
- `DEEPSEEK_MODEL`：DeepSeek 模型名。
- `DEEPSEEK_ATTEMPT_TIMEOUT_MS`：DeepSeek 单次请求超时，默认 45000 毫秒。
- `DEEPSEEK_MAX_TOKENS`：DeepSeek 最大输出 token 数，默认 4096。
- `ADMIN_USERNAME`：后台管理员账号。
- `ADMIN_PASSWORD`：后台管理员密码。
- `ADMIN_SESSION_TOKEN`：后台登录 Cookie 中保存的会话 token。
- `UPLOAD_DIR`：可选，生产环境上传图片持久化目录；不设置时默认写入项目 `public/uploads`。

`.env` 已被 `.gitignore` 忽略。不要提交 `.env`，也不要泄露其中的真实数据库密码或 API Key。

## 代码地图

- `app/`：Next.js App Router 页面和 API。
- `app/page.tsx`：公开首页，展示球队数据，并提供“后台”登录入口。
- `app/admin/page.tsx`：后台控制台入口。
- `app/players/page.tsx`：球员管理和批量导入。
- `app/players/[id]/page.tsx`：球员详情和数据调整。
- `app/seasons/page.tsx`：赛季管理。
- `app/matchdays/internal/page.tsx`：队内赛录入。
- `app/matchdays/external/page.tsx`：队外赛录入。
- `app/matchdays/[id]/confirm/page.tsx`：AI 解析结果确认、编辑和入库。
- `app/matchdays/[id]/share/page.tsx`：比赛日分享页。
- `app/rankings/page.tsx`：赛季榜单。
- `app/team-photos/page.tsx`：球队风采照片管理。
- `app/api/**/route.ts`：服务端 API。
- `components/AppShell.tsx`：后台侧边栏和页面布局。
- `components/MatchEntryForm.tsx`：比赛日录入表单。
- `components/PlayerBulkImport.tsx`：球员名单批量识别和导入。
- `lib/ai/`：DeepSeek 调用、AI 输出 schema、本地解析器、球员名单/阵容解析。
- `lib/server/confirm-matchday.ts`：确认比赛日入库的事务逻辑。
- `lib/server/stats.ts`：从数据库加载已确认比赛并组装统计输入。
- `lib/stats/calculate.ts`：核心统计纯函数，改统计规则时优先看这里。
- `lib/validations.ts`：API 请求 Zod 校验。
- `lib/admin-auth.ts`：后台登录 Cookie 名、账号密码和 session token。
- `middleware.ts`：后台及管理页面的登录态拦截。
- `prisma/schema.prisma`：数据库模型。
- `tests/`：Vitest 测试。

PowerShell 读取含方括号的动态路由文件时，用 `-LiteralPath`，例如 `app/api/matchdays/[id]/route.ts`，避免方括号被当成通配符。

## 登录与后台权限

后台登录流程：

1. 首页点击“后台”，打开管理员登录弹窗。
2. 前端请求 `POST /api/admin/login`。
3. 登录接口校验 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`。
4. 校验成功后设置 `football_admin_session` 这个 httpOnly Cookie。
5. 前端执行 `router.push("/admin")`。
6. `middleware.ts` 读取 Cookie，和 `getAdminSessionToken()` 对比；匹配才放行后台页面。

生产环境中登录 Cookie 设置了 `secure: process.env.NODE_ENV === "production"`。因此线上必须用 HTTPS 访问，否则浏览器会拒绝保存 Secure Cookie，表现为“提示登录成功，但无法跳转后台或跳转后又回到首页”。

腾讯云 + nginx 部署时建议：

- HTTP 统一 301 跳转到 HTTPS。
- nginx 反代时保留 `Host`。
- 设置 `X-Forwarded-Proto $scheme`。
- HTTPS 证书有效。
- 浏览器开发者工具里确认 `/api/admin/login` 响应包含 `Set-Cookie`，并且 Application/Cookies 里存在 `football_admin_session`。

## 领域规则

赛季：

- 赛季由 `startDate` 和 `endDate` 决定。
- 前端可能默认填 3 个月，但数据库和统计逻辑不应写死赛季长度。

队内赛：

- 队伍颜色为红、蓝、白。
- 常规 6 节，赛程顺序为白蓝、白红、红蓝、白蓝、白红、红蓝。
- 单节胜 3 分，平 1 分，负 0 分。
- 当天队伍排名后，该队出勤球员获得个人赛季积分：第一名 +3，第二名 +2，第三名 +1。
- 同分排序依据：总积分、净胜球、相互战绩；仍无法判断时标记需要人工确认。
- 队内赛出勤按当天阵容表计算。
- 阵容表中的临时未到场者仍正常计算出勤和原队排名积分；代打不替换或增加分队记录。
- 临时代打的普通进球、助攻计本人，得分归本次代表队；出勤只算一次，基础赛季积分仍按当天原队排名。
- 全局正式名单中的球员即使没有当天分队，也可录入进球、助攻及乌龙，按代打二次确认；未分队者不增加出勤和队伍排名基础积分，不自动创建分队记录。
- 新识别的未知试训人员会弹窗提示加入正式名单、匹配已有球员或保留试训。转正关联本场全部事件草稿，确认入库后才计正式个人统计；其他比赛日历史试训记录保持原样。
- 试训转正由 `lib/server/resolve-trial.ts` 事务保存正式档案、`TrialResolution` 幂等结果和本场身份草稿，重试受比赛版本保护。身份确认不要求补选原队，也不写入全局别名。
- 试训人员使用比赛日独立 TrialPlayer 身份，不创建虚假的正式 Player；试训事件影响团队比分、积分与名次，不进入正式个人赛季数据。正式球员参与混合事件的进球／助攻正常统计。
- 分队未识别或模糊匹配名字进入试训待确认；管理员可纠正为正式身份，本场名字映射不写入全局别名。
- “临时球员／临时队员／试训／试踢”等称呼按试训识别；赛后事件中未匹配的非空姓名也自动建立本比赛日试训待确认身份。同名进球与助攻复用身份，人工纠正的正式身份继续保留；“临时代打”本身不是试训标记。
- 已撤销本场个人积分资格功能：正式球员均按原队正常计分；pointsEligible 仅保留为旧客户端兼容字段，输入统一为 true，统计不再读取它。撤销迁移按最后一次正式确认记录恢复曾被取消的积分。
- 乌龙球仅计入受益队比分，不增加或扣减个人进球，不计助攻；可以与临时代打同时发生。
- 乌龙与普通进球分区录入、分列展示；正式球员独立统计 internalOwnGoals，不并入普通进球或进球场均。试训乌龙只保留事件节次。
- 代打或乌龙须经录入员二次确认，相关内容改变后旧确认失效。共享检查位于 `lib/match-events.ts`，确认凭证位于 `lib/server/event-confirmation.ts`。

队外赛：

- 统计进球、助攻、出勤。
- 不参与队内赛队伍排名积分。
- 不生成个人队内赛季积分。

统计原则：

- AI 只负责结构化赛后文本，不负责最终榜单计算。
- 榜单必须从数据库事件重新计算，核心事件包括 `TeamAssignment`、`InternalGame`、`GoalEvent`、`TeamMatchdayResult`、`PlayerMatchdayPoint`、`Award`。
- 不要把统计规则分散写在前端页面里。

## AI 解析与确认入库

主要流程：

1. 比赛录入页保存比赛日和原始文本。
2. `/api/matchdays/[id]/parse` 调用 DeepSeek 或本地规则解析器。
3. 解析结果由 `lib/ai/schemas.ts` 校验。
4. 低置信度、无法匹配球员、比分不确定等内容进入确认页人工处理。
5. `/matchdays/[id]/confirm` 允许编辑比分、进球、助攻、球员匹配、额外加分，并可保存别名。
6. `/api/matchdays/[id]/confirm` 调用 `confirmMatchDay`。
7. `confirmMatchDay` 在事务中清理旧正式数据，重建比赛事件、积分、奖项，并把比赛日标记为 `CONFIRMED`。

修改 AI 输出结构或确认流程时，通常要同时检查：

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
- `PlayerStatAdjustment`
- `TeamPhoto`

重要约束：

- 同一比赛日中，一个球员只能有一条 `TeamAssignment`。
- 同一比赛日中，一个 `InternalGame.sectionNo` 唯一。
- 同一球员的同一个别名唯一。
- 重新确认比赛日时，要按现有事务模式清理旧正式数据，避免留下过期事件。
- `GoalEvent.kind` 区分普通进球和乌龙；`teamColor` 是得分队，`scorerRosterTeam` / `assistRosterTeam` 保存当天原队快照。确认时间和管理员名称仅在后台使用，不公开会话凭证。
- `GoalEvent.scorerIsGuest` / `assistIsGuest` 保存两个角色的代打标记；名单外正式球员原队快照为空。不能仅凭空原队快照把历史事件判断为代打或试训。
- GoalEvent 每个参与角色仅引用正式球员或本比赛日试训人员之一；scorerId 可空但不能与 scorerTrialPlayerId 同时为空或同时有值。乌龙的两个助攻引用均须为空。
- 已确认比赛编辑采用 draftAssignments / draftTrialPlayers；正式阵容和事件在确认事务成功之前保持原样，重新解析不得把已确认比赛从统计中移除。

## 开发约定

- 优先沿用现有 TypeScript、Ant Design、Prisma、Zod、App Router 风格。
- API 接收外部输入时先做 Zod 校验。
- 新统计规则优先写在 `lib/stats/calculate.ts`，并补 Vitest。
- 数据库读取聚合尽量放在 `lib/server/`，不要散落在页面里。
- 后台页面保持管理工具风格：清晰、紧凑、可扫描。
- 图标优先使用 `lucide-react`。
- 不要编辑生成目录或依赖目录，例如 `node_modules`、`.next`、`.pnpm-store`、`.tmp`。
- 不要把真实密钥、数据库密码或 `.env` 内容写进任何文档或提交。

## 任务前检查清单

1. 先阅读本文件。
2. 涉及产品目标或总体需求时，再读 `README.md`、`plan.md`、`落地步骤.md`。
3. 涉及页面时，读对应 `app/.../page.tsx` 和相关 `components/`。
4. 涉及 API 时，读对应 `app/api/.../route.ts`、`lib/validations.ts` 和相关 `lib/server/`。
5. 涉及 AI 解析时，读 `lib/ai/schemas.ts`、`lib/ai/deepseek.ts`、`lib/ai/local-parser.ts`、`lib/ai/player-list.ts` 或 `lib/ai/roster.ts`。
6. 涉及统计时，读 `lib/stats/calculate.ts`、`lib/stats/types.ts`、`lib/server/stats.ts` 和 `tests/stats.test.ts`。
7. 修改后按影响范围运行 `pnpm test`，必要时运行 `pnpm build`。
