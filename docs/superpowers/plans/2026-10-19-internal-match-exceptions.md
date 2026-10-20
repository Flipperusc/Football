# 队内赛特殊事件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现已批准的临时代打、乌龙球二次确认，保持名单出勤和原队积分。

**Architecture:** 共享事件检查器负责归属、待确认例外与比分核对。服务端签发绑定比赛版本与事件内容的确认凭证；入库事务验证后保留事件原队快照和管理员确认信息。页面消费同一检查结果，统计及展示按事件类型解释。

**Tech Stack:** Next.js 14、TypeScript、Ant Design 5、Prisma 5、PostgreSQL、Zod、Vitest、Playwright。

**Spec:** tasks/prd-internal-match-event-exceptions.md

## Global Constraints

- 乌龙不计个人进球或助攻；临时未到场者仍按名单获得出勤和积分。
- 代打不更改 TeamAssignment，不增加重复出勤或其他队积分。
- 仅队内赛启用特殊事件；历史数据缺省按普通事件解释。
- 例外、排名、别名全部检查通过后才替换正式数据。
- 不访问或迁移用户现有数据库；迁移验证使用隔离的本地测试数据库。
- 用户已明确直接实施，无额外方案确认；本地功能分支中工作，不提交、推送或部署。

## Review Focus

1. 两名参与者均代打、原队也在本节参赛、代打并乌龙：使用本次代表队而非原队。
2. 无得分队的第三队球员：展示可补选例外，不能选第三队入库。
3. 首次确认、排名确认、表单修改和重试：凭证绑定数据，取消不改正式数据。
4. 已确认比赛重新打开、重新入库：保留特殊性质，不重复计数。
5. 显式比分和模糊特殊文本：不反转比分、不编造事件、不静默当普通进球。

## Task 1: 事件检查与数据结构

Files: lib/match-events.ts, lib/ai/schemas.ts, prisma/schema.prisma, prisma/migrations/20261019000000_match_event_exceptions/migration.sql, tests/match-events.test.ts.

Interface: inspectInternalEvents(parsed, assignments) returns { issues, exceptions, resolutions }; resolution holds credited team, actor roster teams, guest flags. Parsed type is goal | own_goal. Persist kind NORMAL | OWN_GOAL and roster snapshots.

- [x] 写测试：普通、双方代打、乌龙、代打乌龙、未知得分队、比分上限、非法阵容。
- [x] 运行测试确认缺失行为失败。
- [x] 实现检查器和 schema、添加兼容迁移。
- [x] 运行相关测试和 Prisma generate。

## Task 2: 服务端确认与事务

Files: lib/server/confirm-matchday.ts, lib/server/event-confirmation.ts, lib/validations.ts, app/api/matchdays/[id]/confirm/route.ts, tests/confirm-matchday.test.ts.

Interface: EventConfirmationRequired(code MATCH_EVENT_CONFIRMATION_REQUIRED, exceptions, confirmationToken); input eventConfirmationToken?; signed digest binds match ID, updatedAt, parsed content and assignments, excludes manual rank decision.

- [x] 写测试：缺确认不写、确认后保存、修改后失效、排名衔接、事务回滚、队外拒绝乌龙。
- [x] 运行失败测试。
- [x] 接入检查器，先确认例外再确认排名；保存 snapshot、confirmedAt、confirmedBy。
- [x] 相关测试通过。

## Task 3: 解析与统计

Files: lib/ai/deepseek.ts, lib/ai/local-parser.ts, lib/stats/types.ts, lib/stats/calculate.ts, lib/server/stats.ts, lib/stats/player-activity.ts, tests/match-ai.test.ts, tests/stats.test.ts, tests/player-activity.test.ts.

- [x] 写失败测试：明确代打、模糊归属、乌龙、比分不反转；个人计数排除乌龙但保留名单。
- [x] 解析特殊候选，普通无依据 AI 队伍仍按原分队；特殊候选保留得分队。
- [x] 统计和动态识别 OWN_GOAL；服务层传递类型。
- [x] 相关测试通过。

## Task 4: 确认界面和结果展示

Files: app/matchdays/[id]/confirm/page.tsx, components/MatchEventConfirmationModal.tsx, app/matchdays/[id]/share/page.tsx, app/api/public/matchdays/[id]/route.ts, app/players/[id]/page.tsx.

- [x] 补齐浏览器测试：新增、修改类型、补选队、取消、确认、排名衔接、再次编辑。
- [x] 表格沿用现有编辑类型并接入共享事件检查器，保留已保存归属；新增类型和得分队输入。
- [x] 实现集中复核窗口，明确统计影响；任意相关编辑使确认失效。
- [x] 分享页、球员明细标记代打和乌龙，导出保留标记。

## Task 5: E2E、CI 和收尾

Files: e2e/match-event-exceptions.spec.ts, playwright.config.ts, scripts/test-e2e.mjs, .github/workflows/test.yml, package.json, README.md.

- [x] 在隔离 PostgreSQL 上执行全部迁移。
- [x] 自动化登录、建立名单、录入特殊事件、取消与确认、核对正式数据及榜单、重新入库。
- [x] 实际浏览器检查桌面与窄屏；测试自行清理 fixture。
- [x] 全量 pnpm test、类型检查、pnpm build、E2E 通过。
- [x] 独立代码审查并处理重要问题，更新 PRD 完成状态和部署迁移说明。

## Progress / Rulings

- 用户已批准 PRD 并要求直接实施，省略再次方案审批。
- 使用当前干净 checkout 的 codex/internal-match-exceptions 分支，避免建立额外工作目录改变用户项目位置。
- 基线测试因缺失 vitest 依赖无法启动，先恢复锁定依赖；不修改用户环境变量或现有数据库。

## 实施记录（2026-10-20）

- 已实现全部功能和迁移；工作保留在本地功能分支，未提交、推送或上线，未访问业务数据库。
- 原队快照、确认凭证和事件检查分别集中管理，前端编辑允许暂不完整数据，继续沿用既有表单类型；服务端保存仍统一通过 Zod 和共享检查器。
- 146 项 Vitest 测试通过，含原有回归；新增测试均观察到对应失败后修复。最终 4 条真实浏览器/数据库流程全部通过（49.9 秒），生产构建及类型检查通过。
- 桌面和 390px 窄屏已检查；修正比分表溢出，弹窗保留可滚动内容和可见操作按钮。UI detector 无发现。
- 独立审查提出 3 项重要问题，已分别修复并补回归：明确文字优先于 AI 队伍猜测；未知乌龙球员不会吞掉前一普通进球（逗号、空格、无标点）；明确队伍顺序的比分不会因原队归属而反转。
- 未带队伍顺序的普通文本保留既有对齐兼容；有明确顺序或特殊事件时保留比分，冲突交人工处理。
- 审查保留项：普通进球全局去重属既有独立解析策略，本次不扩展；队外乌龙为明确非目标；已有异步解析与确认的竞态另案处理，本次未作该竞态的数据库结论。
- 本次验收使用隔离 PostgreSQL 18 / Edge，CI 配置为 PostgreSQL 16 / Chromium；DeepSeek 通过固定响应测试，不调用真实账号。

交付：本地验收完成，CI 工作流已配置但尚未触发远端运行。迁移只在隔离测试库执行；实际环境需先应用新增迁移，再生成 Prisma Client、构建及重启。
