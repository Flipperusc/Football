# 名单外代打与试训转正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 全局正式球员未分队也可录入代打事件；未知试训身份可在比赛页面转正并转换本场草稿。

**Architecture:** 沿用共享事件检查与确认事务，显式保存两个参与角色的代打标记。提供一次性身份处理事务，将正式档案、幂等处理记录和比赛身份草稿一起保存。现有统计仍从正式事件与阵容计算。

**Tech Stack:** Next.js 14、React 18、Ant Design 5、Prisma 5、PostgreSQL、Zod、Vitest、Playwright。

**Spec:** `tasks/prd-off-roster-guests-and-trial-promotion.md`

## Global Constraints

- 名单外正式代打只计进球、助攻，不增加出勤和队伍排名积分。
- 转正关联本场全部相关事件，确认入库后进入统计；历史比赛保持原样。
- 身份处理不创建当天分队，不自动保存全局别名。
- 已确认比赛的正式事件在再次确认事务成功前保持原样。
- 不读取或输出真实密钥，不对业务数据库运行迁移或测试。

## Review Focus

- 名单外只有助攻的正式球员也必须二次确认并显示正确标记。
- 新建档案后响应丢失，重试不得再次创建或覆盖较新的比赛草稿。
- 试训原名含“试训”等字样，转正及重新解析后仍保持正式身份。
- 转正已有已确认比赛时，不提前删除外键仍引用的试训记录。
- 模态框关闭、刷新、多名身份逐次处理，不能重复提醒已处理身份或遗漏未处理身份。

## Task 1: 正式代打事件与统计

**Files:** `lib/match-events.ts`、`lib/server/confirm-matchday.ts`、`prisma/schema.prisma`、新迁移、公开比赛接口、事件弹窗及相关测试。
**Interfaces:** `EventException` 显式携带正式／试训角色；`EventResolution` 与 `StoredGoalAttribution` 增加 `scorerIsGuest` / `assistIsGuest`。

- [x] 测试未分队进球／助攻、得分队缺失、角色显示、零出勤零基础积分，运行并观察目标测试失败。
- [x] 解除阵容作为身份门槛；服务端在确认前批量验证事件正式 ID；保留二次确认及全部比分检查。
- [x] 新增代打布尔字段及迁移，不把历史空原队快照推断成代打。
- [x] 运行相关 Vitest，验证全部通过。

## Task 2: 持久身份转换

**Files:** 新增 `lib/server/resolve-trial.ts`、`app/api/players/resolve-trial/route.ts`、`TrialResolution` 模型及迁移；更新身份纠正辅助函数和校验。
**Interfaces:** `POST /api/players/resolve-trial` 接收 `trialId`、`trialPlayers`、`name` 或 `playerId`；已保存比赛额外提供 `matchDayId` / `matchDayVersion`，确认页可提交当前 `parsedJson`。

- [x] 测试正式映射无需阵容、所有事件角色转换和旧原文保留，观察旧逻辑失败。
- [x] 在 READ COMMITTED 事务中处理姓名冲突、正式创建／匹配、当前身份草稿及请求去重；使用试训 ID 事务锁与比赛行锁保护并发。
- [x] 重试复用相同结果；比赛版本变化拒绝覆盖；正式比赛事件不修改。
- [x] 用隔离数据库 E2E 验证事务失败、重复请求、旧比赛保护和历史身份保持。

## Task 3: 页面接入

**Files:** `TrialPlayersPanel.tsx`、`MatchEntryForm.tsx`、确认页；按需要新增独立身份提示组件。
**Interfaces:** 试训面板提供异步 `onResolve(trialId, {name} | {playerId})`，由父页面提交快照和更新状态；不要求选择原队。

- [x] 写浏览器流程测试：自动弹窗、一键新增、保留试训、匹配已有、名单外进球与助攻。
- [x] 统一复用试训表操作，逐人处理，允许稍后处理；已确认试训不反复弹窗。
- [x] 两个父页面同步球员、试训列表、本场纠正映射及版本；确认页全量替换对应事件角色。
- [x] 修正二次确认文案，展示正式未分队与试训的区别。

## Task 4: 完整验证与交付

- [x] 运行 `corepack pnpm test`、`corepack pnpm build`、`corepack pnpm test:e2e`。
- [x] 由独立审阅者检查本次差异，修复有影响的问题并运行对应回归。
- [x] 更新 README、AGENTS 领域规则及 PRD 实施状态，记录迁移要求。

## Progress / Decisions

- 2026-10-25：用户要求直接实现，沿用当前非主分支 `codex/trial-players-points-eligibility` 和工作区，初始只有本任务 PRD 未跟踪；不切换工作区或提交其他工作。
- 2026-10-25：各步骤共享身份与事件模型，采用当前会话顺序实现；最终独立审阅。保留本地改动供用户查看，不自动推送或部署。
- 2026-10-25：新增 `TrialResolution` 保存单次身份转换结果，保证刷新重试去重；已保存比赛用版本校验保护并发编辑。
- 2026-10-25：隔离库 E2E 发现现有球员身份唯一性触发器要求 READ COMMITTED。转换事务改用该级别，读取处理记录前取得试训 ID advisory lock，读取比赛版本前取得行锁；重复并发请求和事务回滚已在真实隔离库验证。
- 2026-10-25：独立审阅发现重试覆盖新本地草稿、重新识别阵容遗漏本场映射两项问题。已先复现，再修复：重试返回当前提交草稿的身份转换，不重写已提交比赛；文本及图片阵容结果统一应用本场映射，不写全局别名。

## Final Verification — 2026-10-25

- `node node_modules/vitest/vitest.mjs run`：34 个文件，197 项测试通过。
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`：通过。
- `node node_modules/next/dist/bin/next build`：生产构建通过，包括类型检查与页面生成；构建使用本地占位数据库地址，未连接业务数据库。
- `$env:E2E_USE_BUILD = '1'; node scripts/test-e2e.mjs`：全部 14 项浏览器测试通过，真实 UI / API / PostgreSQL 在生产构建下运行。
- 浏览器覆盖名单外进球与助攻、特殊事件确认、转正失败重试、同名阻止、并发去重、事务回滚、刷新恢复、多人分别处理、保留试训、本场改名映射、重新解析和确认、历史正式数据保护；已查看桌面及 390px 手机端弹窗截图。
- 新迁移已在独立本地 `football_e2e` 数据库执行。测试使用临时管理员凭证、空 DeepSeek Key，并自行清理测试夹具。
- 本次最终验证直接调用项目已安装的 CLI，分别等价于 `pnpm test`、`pnpm build` 和 `pnpm test:e2e`。业务数据库未迁移，线上未部署，未创建提交或推送；远程 CI 留待代码推送后运行。
