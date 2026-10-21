import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.E2E_DATABASE_URL } } });
async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const suffix = [...tag].map((char) => "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳"[Number.parseInt(char, 16)]).join("");
  const names = { star: `正甲${suffix}`, helper: `正乙${suffix}`, blue: `正丙${suffix}`, own: `正丁${suffix}`, trial: `试训${suffix}` };
  const players = await Promise.all(Object.entries(names).filter(([role]) => role !== "trial").map(async ([role, name]) => ({ role, ...await prisma.player.create({ data: { name } }) })));
  const ids = Object.fromEntries(players.map((player) => [player.role, player.id]));
  const season = await prisma.season.create({ data: { name: `Trial E2E ${tag}`, startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31") } });
  return { names, ids, players, season };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function cleanup(data: Fixture) {
  await prisma.matchDay.deleteMany({ where: { seasonId: data.season.id } });
  await prisma.season.delete({ where: { id: data.season.id } });
  await prisma.player.deleteMany({ where: { id: { in: data.players.map((player) => player.id) } } });
}
async function login(page: Page) {
  const response = await page.request.post("/api/admin/login", { data: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } });
  expect(response.ok()).toBeTruthy();
  // Production cookies are Secure. Explicitly forward the real login cookie only
  // in this loopback test harness, without changing application cookie policy.
  if (process.env.E2E_USE_BUILD === "1") await page.context().setExtraHTTPHeaders({ Cookie: response.headers()["set-cookie"].split(";")[0] });
}
async function selectOption(page: Page, label: string, value: string) {
  const input = page.getByRole("combobox", { name: label === "赛季" ? /赛季/ : label, exact: label !== "赛季" });
  // Wait for modal transition focus handling before opening its body-mounted popup.
  await expect(page.locator(".ant-modal[class*=zoom-appear], .ant-modal[class*=zoom-enter], .ant-modal[class*=zoom-leave]")).toHaveCount(0);
  await page.locator(".ant-select").filter({ has: input }).locator(".ant-select-selector").click();
  if (await input.isEditable()) await input.fill(value);
  const listId = await input.getAttribute("aria-controls");
  const popup = page.locator(".ant-select-dropdown").filter({ has: page.locator(`[id="${listId}"]`) });
  await popup.getByText(value, { exact: true }).click();
  await expect(popup).toBeHidden();
}
async function save(page: Page, matchId: string, editing = false) {
  await page.getByRole("button", { name: editing ? "保存修改并重新入库" : "确认入库", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "特殊比赛事件确认" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认特殊事件并继续" }).click();
  await page.waitForURL(`**/matchdays/${matchId}/share`);
}
async function stats(page: Page, seasonId: string) {
  const response = await page.request.get(`/api/stats/season/${seasonId}/players`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Array<{ playerId: string; internalGoals: number; internalAssists: number; internalOwnGoals: number; internalAppearances: number; internalSeasonPoints: number }>>;
}

test.afterAll(async () => { await prisma.$disconnect(); });

test("unlisted event participants automatically become pending trials", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    const created = await page.request.post("/api/matchdays", { data: { seasonId: data.season.id, date: "2026-10-21", type: "INTERNAL", assignments: [
      { playerId: data.ids.star, teamColor: "RED" }, { playerId: data.ids.blue, teamColor: "BLUE" }, { playerId: data.ids.own, teamColor: "WHITE" }
    ] } });
    expect(created.ok()).toBeTruthy();
    const match = await created.json();
    const rawText = `第一节白蓝0:2，临时球员替蓝队进球，陌生球员替蓝队进球\n第二节白红0:1\n第三节红蓝1:0\n第四节白蓝0:0\n第五节白红0:1\n第六节红蓝1:0`;
    expect((await page.request.post(`/api/matchdays/${match.id}/parse`, { data: { matchType: "INTERNAL", rawText } })).ok()).toBeTruthy();
    await page.goto(`/matchdays/${match.id}/confirm`);
    const trials = page.getByRole("region", { name: "试训球员", exact: true });
    for (const name of ["临时球员", "陌生球员"]) {
      const row = trials.getByRole("row").filter({ hasText: name });
      await expect(row).toContainText("待确认");
      await row.getByRole("button", { name: "确认为试训", exact: true }).click();
    }
    await save(page, match.id);
    expect(await prisma.trialPlayer.count({ where: { matchDayId: match.id, confirmed: true } })).toBe(2);
    const events = await prisma.goalEvent.findMany({ where: { matchDayId: match.id } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.scorerId === null && !!event.scorerTrialPlayerId)).toBe(true);
  } finally { await cleanup(data); }
});

test("retiring eligibility restores committed points without using newer drafts", async () => {
  const data = await fixture();
  const rollback = new Error("rollback migration verification");
  try {
    await prisma.$transaction(async (tx) => {
      const match = await tx.matchDay.create({ data: { seasonId: data.season.id, date: new Date("2026-10-21"), type: "INTERNAL", parseStatus: "CONFIRMED", draftAssignments: [{ playerId: data.ids.star, teamColor: "RED", pointsEligible: false }] } });
      await tx.teamAssignment.create({ data: { matchDayId: match.id, playerId: data.ids.star, teamColor: "RED", pointsEligible: false } });
      await tx.teamMatchdayResult.create({ data: { matchDayId: match.id, teamColor: "RED", matchPoints: 12, goalsFor: 4, goalsAgainst: 0, goalDifference: 4, rank: 1, seasonPointsAwarded: 3 } });
      await tx.playerMatchdayPoint.create({ data: { matchDayId: match.id, playerId: data.ids.star, basePoints: 0, bonusPoints: 0, totalPoints: 0 } });
      await tx.award.create({ data: { matchDayId: match.id, playerId: data.ids.star, name: "最佳球员", points: 2 } });
      for (const [modelName, points] of [["manual-confirmation", 1], ["draft", 99]] as const) {
        await tx.matchParseResult.create({ data: { matchDayId: match.id, rawText: "", status: "SUCCESS", modelName, parsedJson: { bonusPoints: [{ player: { playerId: data.ids.star }, points }] } } });
      }
      const sql = await readFile("prisma/migrations/20261021010000_retire_points_eligibility/migration.sql", "utf8");
      for (const statement of sql.split(";").filter((part) => part.trim())) await tx.$executeRawUnsafe(statement);
      expect(await tx.playerMatchdayPoint.findFirst({ where: { matchDayId: match.id } })).toMatchObject({ basePoints: 3, bonusPoints: 3, totalPoints: 6 });
      expect(await tx.teamAssignment.findFirst({ where: { matchDayId: match.id } })).toMatchObject({ pointsEligible: true });
      expect((await tx.matchDay.findUniqueOrThrow({ where: { id: match.id } })).draftAssignments).toEqual([{ playerId: data.ids.star, teamColor: "RED", pointsEligible: true }]);
      throw rollback;
    }).catch((error) => { if (error !== rollback) throw error; });
  } finally { await cleanup(data); }
});

test("unknown roster player becomes a trial; mixed events, own goals and normal points survive reopening", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    await page.goto("/matchdays/internal");
    await selectOption(page, "赛季", data.season.name);
    await page.getByLabel(/日期/).fill("2026-10-21");
    await page.getByPlaceholder(/^红\n/).fill(`红\n${data.names.star}\n${data.names.helper}\n蓝\n${data.names.blue}\n${data.names.trial}\n白\n${data.names.own}`);
    await page.getByRole("button", { name: "DeepSeek 识别文本并填入阵容", exact: true }).click();
    const trialRow = page.getByRole("region", { name: "试训球员", exact: true }).getByRole("row").filter({ hasText: data.names.trial });
    await expect(trialRow).toContainText("待确认");
    await trialRow.getByRole("button", { name: "确认为试训", exact: true }).click();
    const rawText = `第一节白蓝0:4，${data.names.helper}助攻${data.names.trial}替蓝队进球，${data.names.trial}助攻${data.names.star}替蓝队进球，${data.names.trial}替白队乌龙，${data.names.own}乌龙\n第二节白红0:1\n第三节红蓝1:0，${data.names.trial}替红队进球\n第四节白蓝0:0\n第五节白红0:1\n第六节红蓝1:0\n${data.names.star}加1分\n${data.names.star}加1分`;
    await page.getByLabel(/赛后文本/).fill(rawText);
    await page.getByRole("button", { name: "保存并解析", exact: true }).click();
    await page.waitForURL(/\/matchdays\/[^/]+\/confirm$/);
    const matchId = page.url().split("/").at(-2)!;
    await expect(page.getByRole("heading", { name: "普通进球", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "乌龙球", exact: true })).toBeVisible();
    await expect(trialRow).toContainText("第 1 节");
    await expect(trialRow).toContainText("第 3 节");
    const detail = await (await page.request.get(`/api/matchdays/${matchId}`)).json();
    expect(detail.trialPlayers).toHaveLength(1);
    expect(detail.trialPlayers[0]).toMatchObject({ name: data.names.trial, confirmed: true });
    expect(detail.assignments).toHaveLength(4);
    // Own-goal rows must not expose an assist input, including a disabled one.
    for (const [index, event] of detail.parseResults[0].parsedJson.games[0].events.entries()) {
      if (event.type === "own_goal") await expect(page.getByRole("combobox", { name: `第1节事件${index + 1}助攻`, exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: ".test-state/trial-players-desktop.png", fullPage: true });
    await expect(page.getByRole("heading", { name: "本场个人积分资格" })).toHaveCount(0);
    const normalPanel = page.getByRole("heading", { name: "普通进球", exact: true }).locator("..").locator("..");
    await expect(normalPanel.getByRole("columnheader", { name: "事件类型" })).toHaveCount(0);
    const specialPanel = page.getByRole("heading", { name: "特殊积分与奖项" }).locator("..").locator("..");
    await expect(specialPanel.getByRole("columnheader", { name: "附带积分" })).toHaveCount(0);
    await expect(specialPanel.getByRole("columnheader", { name: "计分状态" })).toHaveCount(0);
    const aliasBox = await page.getByRole("heading", { name: "保存新别名" }).boundingBox();
    const trialBox = await page.getByRole("heading", { name: "试训球员", exact: true }).boundingBox();
    expect(aliasBox!.y).toBeLessThan(trialBox!.y);
    await save(page, matchId);
    await expect(page.locator(".match-share-table thead").getByRole("cell", { name: "乌龙", exact: true })).toHaveCount(3);
    const firstStats = await stats(page, data.season.id);
    expect(firstStats.find((row) => row.playerId === data.ids.star)).toMatchObject({ internalGoals: 1, internalAppearances: 1, internalSeasonPoints: 5 });
    expect(firstStats.find((row) => row.playerId === data.ids.helper)).toMatchObject({ internalAssists: 1, internalSeasonPoints: 3 });
    expect(firstStats.find((row) => row.playerId === data.ids.own)).toMatchObject({ internalGoals: 0, internalAssists: 0, internalOwnGoals: 1 });
    expect(await prisma.player.count({ where: { name: data.names.trial } })).toBe(0);
    const events = await prisma.goalEvent.findMany({ where: { matchDayId: matchId } });
    expect(events).toHaveLength(5);
    expect(events.filter((event) => event.kind === "OWN_GOAL")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "OWN_GOAL").every((event) => !event.assistPlayerId && !event.assistTrialPlayerId)).toBe(true);
    const beforeTeams = await prisma.teamMatchdayResult.findMany({ where: { matchDayId: matchId }, orderBy: { teamColor: "asc" } });
    expect(beforeTeams.find((team) => team.teamColor === "RED")?.rank).toBe(1);
    expect(await prisma.playerMatchdayPoint.findUnique({ where: { matchDayId_playerId: { matchDayId: matchId, playerId: data.ids.star } } })).toMatchObject({ basePoints: 3, bonusPoints: 2, totalPoints: 5 });
    await page.goto(`/matchdays/${matchId}/confirm`);
    await expect(trialRow).toContainText(data.names.trial);
    await save(page, matchId, true);
    const restored = await stats(page, data.season.id);
    expect(restored.find((row) => row.playerId === data.ids.star)).toMatchObject({ internalGoals: 1, internalAppearances: 1, internalSeasonPoints: 5 });
    expect(await prisma.goalEvent.count({ where: { matchDayId: matchId } })).toBe(5);
    const afterTeams = await prisma.teamMatchdayResult.findMany({ where: { matchDayId: matchId }, orderBy: { teamColor: "asc" } });
    expect(afterTeams.map(({ id, ...team }) => team)).toEqual(beforeTeams.map(({ id, ...team }) => team));
    await expect(page.getByText(`${data.names.trial}（试训）`, { exact: false }).first()).toBeVisible();
    await page.goto(`/players/${data.ids.own}`);
    await page.locator(".page-title .ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByText(data.season.name, { exact: true }).click();
    const ownMetric = page.locator(".metric-card").filter({ hasText: "队内乌龙球" });
    await expect(ownMetric.locator("strong")).toHaveText("1");
    await expect(page.getByRole("columnheader", { name: "乌龙球", exact: true })).toBeVisible();
    await expect(page.getByText(/第 1 节：乌龙 ×1/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/matchdays/${matchId}/confirm`);
    await expect(page.getByRole("heading", { name: "试训球员", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.screenshot({ path: ".test-state/trial-players-mobile.png", fullPage: true });
    // Editing/reparsing a confirmed day must not leak draft eligibility into public statistics.
    const savedDetail = await (await page.request.get(`/api/matchdays/${matchId}`)).json();
    const oldEvents = await prisma.goalEvent.findMany({ where: { matchDayId: matchId }, orderBy: { id: "asc" } });
    const draftAssignments = savedDetail.assignments.map((row: { playerId: string; pointsEligible: boolean }) => ({ ...row, pointsEligible: row.playerId === data.ids.star ? false : row.pointsEligible }));
    const draftResponse = await page.request.patch(`/api/matchdays/${matchId}`, { data: { assignments: draftAssignments, trialPlayers: savedDetail.trialPlayers } });
    expect(draftResponse.ok()).toBeTruthy();
    expect(await prisma.teamAssignment.findUnique({ where: { matchDayId_playerId: { matchDayId: matchId, playerId: data.ids.star } } })).toMatchObject({ pointsEligible: true });
    expect((await stats(page, data.season.id)).find((row) => row.playerId === data.ids.star)?.internalSeasonPoints).toBe(5);
    const reparse = await page.request.post(`/api/matchdays/${matchId}/parse`, { data: { matchType: "INTERNAL", rawText } });
    expect(reparse.ok()).toBeTruthy();
    expect(await prisma.matchDay.findUnique({ where: { id: matchId } })).toMatchObject({ parseStatus: "CONFIRMED" });
    expect(await prisma.goalEvent.findMany({ where: { matchDayId: matchId }, orderBy: { id: "asc" } })).toEqual(oldEvents);
    expect((await stats(page, data.season.id)).find((row) => row.playerId === data.ids.star)?.internalSeasonPoints).toBe(5);
    await page.goto(`/matchdays/${matchId}/confirm`);
    await expect(page.getByRole("heading", { name: "本场个人积分资格" })).toHaveCount(0);
    await save(page, matchId, true);
    expect((await stats(page, data.season.id)).find((row) => row.playerId === data.ids.star)?.internalSeasonPoints).toBe(5);
    expect(await prisma.goalEvent.count({ where: { matchDayId: matchId } })).toBe(5);
    expect(await prisma.matchDay.findUnique({ where: { id: matchId } })).toMatchObject({ draftAssignments: null, draftTrialPlayers: null });
  } finally { await cleanup(data); }
});

test("pending and foreign trial identities, stale identity proofs and own-goal assists cannot replace saved data", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    const trial = { id: randomUUID(), name: data.names.trial, confirmed: false };
    const assignments = [
      { playerId: data.ids.star, teamColor: "RED", pointsEligible: true },
      { playerId: data.ids.helper, teamColor: "RED", pointsEligible: true },
      { playerId: data.ids.blue, teamColor: "BLUE", pointsEligible: true },
      { playerId: data.ids.own, teamColor: "WHITE", pointsEligible: true }
    ];
    const created = await page.request.post("/api/matchdays", { data: { seasonId: data.season.id, date: "2026-10-21", type: "INTERNAL", assignments, trialPlayers: [trial] } });
    expect(created.ok()).toBeTruthy();
    const match = await created.json();
    const ref = { playerId: null, trialPlayerId: trial.id, rawName: trial.name, confidence: 1 };
    const formal = { playerId: data.ids.helper, rawName: data.names.helper, confidence: 1 };
    const event = { type: "goal", team: "blue", scorer: ref, assist: formal, count: 1, rawText: "试训进球", confidence: 1 };
    const games = [
      { sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 1, events: [event], rawText: "第一节白蓝0:1" },
      { sectionNo: 2, teamA: "white", teamB: "red", scoreA: 0, scoreB: 1, events: [], rawText: "第二节白红0:1" },
      { sectionNo: 3, teamA: "red", teamB: "blue", scoreA: 1, scoreB: 0, events: [], rawText: "第三节红蓝1:0" },
      { sectionNo: 4, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 0, events: [], rawText: "第四节白蓝0:0" },
      { sectionNo: 5, teamA: "white", teamB: "red", scoreA: 0, scoreB: 1, events: [], rawText: "第五节白红0:1" },
      { sectionNo: 6, teamA: "red", teamB: "blue", scoreA: 1, scoreB: 0, events: [], rawText: "第六节红蓝1:0" }
    ];
    const input = { matchDayVersion: match.updatedAt, trialPlayers: [trial], teamAssignments: assignments,
      parsedJson: { matchType: "internal", games, awards: [] as unknown[], bonusPoints: [], uncertainItems: [] } };
    const url = `/api/matchdays/${match.id}/confirm`;
    const pending = await page.request.post(url, { data: input });
    expect(pending.status()).toBe(422);
    expect((await pending.json()).message).toMatch(/确认|试训/);
    expect(await prisma.goalEvent.count({ where: { matchDayId: match.id } })).toBe(0);
    trial.confirmed = true;
    const preview = await page.request.post(url, { data: input });
    expect(preview.status()).toBe(409);
    const { confirmationToken } = await preview.json();
    expect(confirmationToken).toBeTruthy();
    const changed = structuredClone(input);
    changed.trialPlayers[0].name = "修改后的试训姓名";
    const stale = await page.request.post(url, { data: { ...changed, eventConfirmationToken: confirmationToken } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("MATCH_EVENT_CONFIRMATION_REQUIRED");
    const ownWithAssist = structuredClone(input);
    ownWithAssist.parsedJson.games[0].events[0].type = "own_goal";
    expect((await page.request.post(url, { data: ownWithAssist })).status()).toBe(422);
    const foreignCreate = await page.request.post("/api/matchdays", { data: { seasonId: data.season.id, date: "2026-10-22", type: "INTERNAL", assignments, trialPlayers: [{ id: randomUUID(), name: "另一场试训", confirmed: true }] } });
    expect(foreignCreate.ok()).toBeTruthy();
    const foreign = await foreignCreate.json();
    const forged = structuredClone(input);
    forged.trialPlayers = foreign.trialPlayers;
    forged.parsedJson.games[0].events[0].scorer.trialPlayerId = foreign.trialPlayers[0].id;
    expect((await page.request.post(url, { data: forged })).ok()).toBe(false);
    const success = await page.request.post(url, { data: { ...input, eventConfirmationToken: confirmationToken } });
    expect(success.ok()).toBeTruthy();
    const before = await prisma.goalEvent.findMany({ where: { matchDayId: match.id }, orderBy: { id: "asc" } });
    input.matchDayVersion = (await success.json()).updatedAt;
    input.parsedJson.awards = [{ name: "最佳后卫", players: [{ playerId: "nonexistent-player", rawName: "无效球员", confidence: 1 }], points: 1, rawText: "" }];
    const failedPreview = await page.request.post(url, { data: input });
    if (failedPreview.status() === 409) {
      const proof = (await failedPreview.json()).confirmationToken;
      expect((await page.request.post(url, { data: { ...input, eventConfirmationToken: proof } })).ok()).toBe(false);
    } else expect(failedPreview.ok()).toBe(false);
    expect(await prisma.goalEvent.findMany({ where: { matchDayId: match.id }, orderBy: { id: "asc" } })).toEqual(before);
  } finally { await cleanup(data); }
});


test("correcting a pending trial identity updates all event roles without orphan identities", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    const trialId = randomUUID();
    const created = await page.request.post("/api/matchdays", { data: {
      seasonId: data.season.id, date: "2026-10-23", type: "INTERNAL",
      assignments: [
        { playerId: data.ids.star, teamColor: "RED" }, { playerId: data.ids.helper, teamColor: "RED" },
        { playerId: data.ids.blue, teamColor: "BLUE" }, { playerId: data.ids.own, teamColor: "WHITE" }
      ],
      trialPlayers: [{ id: trialId, name: data.names.trial, confirmed: false }]
    } });
    expect(created.ok()).toBeTruthy();
    const match = await created.json();
    const rawText = `第一节白蓝0:1，${data.names.helper}助攻${data.names.trial}替蓝队进球\n第二节白红0:1\n第三节红蓝1:0\n第四节白蓝0:1，${data.names.trial}助攻${data.names.blue}进球\n第五节白红0:1\n第六节红蓝1:0`;
    expect((await page.request.post(`/api/matchdays/${match.id}/parse`, { data: { matchType: "INTERNAL", rawText } })).ok()).toBeTruthy();
    await page.goto(`/matchdays/${match.id}/confirm`);
    const trialRegion = page.getByRole("region", { name: "试训球员", exact: true });
    const trialRow = trialRegion.getByRole("row").filter({ hasText: data.names.trial });
    await expect(trialRow).toContainText("待确认");
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    await expect(page.getByText("仍有试训球员待确认，请在试训区域确认身份或匹配正式球员", { exact: true })).toBeVisible();
    expect(await prisma.goalEvent.count({ where: { matchDayId: match.id } })).toBe(0);
    await trialRow.getByRole("button", { name: "匹配正式球员", exact: true }).click();
    const correction = page.getByRole("dialog", { name: "匹配正式球员", exact: true });
    await expect(correction.getByRole("button", { name: "确认匹配", exact: true })).toBeDisabled();
    await selectOption(page, "匹配正式球员姓名", data.names.star);
    await selectOption(page, "正式球员当天原队", "蓝队");
    await correction.getByRole("button", { name: "确认匹配", exact: true }).click();
    await expect(trialRow).toHaveCount(0);
    // The edit is only a draft until confirmation; the persisted pending identity remains intact.
    expect(await prisma.trialPlayer.count({ where: { id: trialId, matchDayId: match.id } })).toBe(1);
    await save(page, match.id);
    expect(await prisma.trialPlayer.count({ where: { matchDayId: match.id } })).toBe(0);
    const events = await prisma.goalEvent.findMany({ where: { matchDayId: match.id }, orderBy: { internalGame: { sectionNo: "asc" } } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ scorerId: data.ids.star, scorerTrialPlayerId: null, assistPlayerId: data.ids.helper });
    expect(events[1]).toMatchObject({ scorerId: data.ids.blue, assistPlayerId: data.ids.star, assistTrialPlayerId: null });
    expect(await prisma.teamAssignment.findUnique({ where: { matchDayId_playerId: { matchDayId: match.id, playerId: data.ids.star } } })).toMatchObject({ teamColor: "RED" });
    const actualStats = await stats(page, data.season.id);
    expect(actualStats.find((row) => row.playerId === data.ids.star)).toMatchObject({ internalGoals: 1, internalAssists: 1, internalAppearances: 1, internalSeasonPoints: 3 });
    await page.goto(`/matchdays/${match.id}/confirm`);
    await expect(trialRegion).toContainText("暂无试训球员");
    await save(page, match.id, true);
    expect(await prisma.goalEvent.count({ where: { matchDayId: match.id } })).toBe(2);
  } finally { await cleanup(data); }
});

test("roster-stage correction is preserved when raw names are parsed into formal events", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    await page.goto("/matchdays/internal");
    await selectOption(page, "赛季", data.season.name);
    await page.getByLabel(/日期/).fill("2026-10-24");
    await page.getByPlaceholder(/^红\n/).fill(`红\n${data.names.star}\n${data.names.helper}\n蓝\n${data.names.blue}\n${data.names.trial}\n白\n${data.names.own}`);
    await page.getByRole("button", { name: "DeepSeek 识别文本并填入阵容", exact: true }).click();
    const trialRegion = page.getByRole("region", { name: "试训球员", exact: true });
    const trialRow = trialRegion.getByRole("row").filter({ hasText: data.names.trial });
    await expect(trialRow).toContainText("待确认");
    await trialRow.getByRole("button", { name: "匹配正式球员", exact: true }).click();
    await selectOption(page, "匹配正式球员姓名", data.names.star);
    await selectOption(page, "正式球员当天原队", "红队");
    await page.getByRole("dialog", { name: "匹配正式球员", exact: true }).getByRole("button", { name: "确认匹配", exact: true }).click();
    await expect(trialRow).toHaveCount(0);
    await page.getByLabel(/赛后文本/).fill(`第一节白蓝0:1，${data.names.trial}替蓝队进球\n第二节白红0:1\n第三节红蓝1:0\n第四节白蓝0:0\n第五节白红0:1\n第六节红蓝1:0`);
    await page.getByRole("button", { name: "保存并解析", exact: true }).click();
    await page.waitForURL(/\/matchdays\/[^/]+\/confirm$/);
    const matchId = page.url().split("/").at(-2)!;
    const detail = await (await page.request.get(`/api/matchdays/${matchId}`)).json();
    expect(detail.participantCorrections).toContainEqual({ rawName: data.names.trial, playerId: data.ids.star });
    expect(detail.trialPlayers).toHaveLength(0);
    expect(detail.parseResults[0].parsedJson.games[0].events[0].scorer).toMatchObject({ playerId: data.ids.star });
    await save(page, matchId);
    expect(await prisma.goalEvent.findFirstOrThrow({ where: { matchDayId: matchId } })).toMatchObject({ scorerId: data.ids.star, scorerTrialPlayerId: null });
    expect((await stats(page, data.season.id)).find((row) => row.playerId === data.ids.star)).toMatchObject({ internalGoals: 1, internalAppearances: 1, internalSeasonPoints: 3 });
  } finally { await cleanup(data); }
});
