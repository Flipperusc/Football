import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.E2E_DATABASE_URL } } });
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const tag = randomUUID().slice(0, 8);
  const names = { guest: `球员甲${tag}`, helper: `球员乙${tag}`, absent: `球员丁${tag}`, own: `球员丙${tag}` };
  const players = await Promise.all(Object.entries(names).map(async ([role, name]) => ({ role, ...await prisma.player.create({ data: { name } }) })));
  const ids = Object.fromEntries(players.map((player) => [player.role, player.id]));
  const season = await prisma.season.create({ data: { name: `E2E ${tag}`, startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31") } });
  const match = await prisma.matchDay.create({ data: { seasonId: season.id, date: new Date("2026-10-19"), type: "INTERNAL",
    assignments: { create: [
      { playerId: ids.guest, teamColor: "RED" }, { playerId: ids.helper, teamColor: "RED" },
      { playerId: ids.absent, teamColor: "BLUE" }, { playerId: ids.own, teamColor: "WHITE" }
    ] } } });
  const rawText = `第一节白蓝0:2${names.helper}助攻${names.guest}替蓝队进球，${names.own}进球\n第二节白红0:1\n第三节红蓝1:0\n第四节白蓝0:0\n第五节白红0:1\n第六节红蓝1:0`;
  return { ids, names, season, match, rawText, players };
}
async function cleanup(data: Fixture) {
  await prisma.matchDay.deleteMany({ where: { seasonId: data.season.id } });
  await prisma.season.delete({ where: { id: data.season.id } });
  await prisma.player.deleteMany({ where: { id: { in: data.players.map((player) => player.id) } } });
}
async function login(page: Page) {
  const response = await page.request.post("/api/admin/login", { data: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } });
  expect(response.ok()).toBeTruthy();
  // Forward the authenticated Secure cookie for API calls over test-only loopback HTTP.
  if (process.env.E2E_USE_BUILD === "1") await page.context().setExtraHTTPHeaders({ Cookie: response.headers()["set-cookie"].split(";")[0] });
}
async function parseFixture(page: Page, data: Fixture) {
  const response = await page.request.post(`/api/matchdays/${data.match.id}/parse`, { data: { matchType: "INTERNAL", rawText: data.rawText } });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/matchdays/${data.match.id}/confirm`);
  await expect(page.getByRole("heading", { name: "AI 解析确认" })).toBeVisible();
}
async function selectOption(page: Page, label: string, value: string) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  // Wait for modal transition focus handling before opening its body-mounted popup.
  await expect(page.locator(".ant-modal[class*=zoom-appear], .ant-modal[class*=zoom-enter], .ant-modal[class*=zoom-leave]")).toHaveCount(0);
  await page.locator(".ant-select").filter({ has: input }).locator(".ant-select-selector").click();
  if (await input.isEditable()) await input.fill(value);
  await expect(input).toHaveAttribute("aria-expanded", "true");
  const listId = await input.getAttribute("aria-controls");
  const popup = page.locator(".ant-select-dropdown").filter({ has: page.locator(`[id="${listId}"]`) });
  await popup.getByText(value, { exact: true }).click();
  await expect(popup).toBeHidden();
}

test.afterAll(async () => { await prisma.$disconnect(); });

test("guest goals, own goals, cancel, re-confirmation and roster-based statistics", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    await parseFixture(page, data);
    await page.getByRole("button", { name: "第1节事件2转为乌龙球", exact: true }).click();
    await page.getByRole("dialog").filter({ hasText: "转为乌龙球" }).getByRole("button", { name: "确认转换", exact: true }).click();
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "特殊比赛事件确认" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("乌龙球不计个人进球和助攻", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/临时未到场者仍正常计算/)).toBeVisible();
    await page.screenshot({ path: ".test-state/confirmation-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.screenshot({ path: ".test-state/confirmation-mobile.png", fullPage: true });
    await dialog.getByRole("button", { name: "返回修改" }).click();
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    const confirmUrl = `**/api/matchdays/${data.match.id}/confirm`;
    await page.route(confirmUrl, (route) => route.fulfill({ status: 503, json: { message: "测试保存失败，请重试" } }));
    await dialog.getByRole("button", { name: "确认特殊事件并继续" }).click();
    await expect(dialog.getByText("测试保存失败，请重试", { exact: true })).toBeVisible();
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(0);
    await page.unroute(confirmUrl);
    await dialog.getByRole("button", { name: "确认特殊事件并继续" }).click();
    await page.waitForURL(`**/matchdays/${data.match.id}/share`);
    await expect(page.getByText(`${data.names.own}（乌龙）`, { exact: false })).toBeVisible();
    await expect(page.getByText(`${data.names.guest}（代打）`, { exact: false })).toBeVisible();
    const goals = await prisma.goalEvent.findMany({ where: { matchDayId: data.match.id } });
    expect(goals).toHaveLength(2);
    expect(goals.every((goal) => goal.teamColor === "BLUE" && goal.exceptionConfirmedBy === "e2e-admin")).toBe(true);
    expect(goals.find((goal) => goal.kind === "OWN_GOAL")?.assistPlayerId).toBeNull();
    const response = await page.request.get(`/api/stats/season/${data.season.id}/players`);
    const stats = await response.json();
    expect(stats.find((row: { playerId: string }) => row.playerId === data.ids.guest)).toMatchObject({ internalGoals: 1, internalAppearances: 1, internalSeasonPoints: 3 });
    expect(stats.find((row: { playerId: string }) => row.playerId === data.ids.helper)).toMatchObject({ internalAssists: 1, internalAppearances: 1, internalSeasonPoints: 3 });
    expect(stats.find((row: { playerId: string }) => row.playerId === data.ids.absent)).toMatchObject({ internalGoals: 0, internalAppearances: 1, internalSeasonPoints: 2 });
    expect(stats.find((row: { playerId: string }) => row.playerId === data.ids.own)).toMatchObject({ internalGoals: 0, internalAssists: 0, internalAppearances: 1, internalSeasonPoints: 1 });
    await page.goto(`/matchdays/${data.match.id}/confirm`);
    await expect(page.getByRole("combobox", { name: "第1节事件2类型" })).toBeVisible();
    await page.getByRole("button", { name: "保存修改并重新入库", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "返回修改" }).click();
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(2);
    await page.getByRole("button", { name: "保存修改并重新入库", exact: true }).click();
    await dialog.getByRole("button", { name: "确认特殊事件并继续" }).click();
    await page.waitForURL(`**/matchdays/${data.match.id}/share`);
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(2);
    expect(await prisma.teamAssignment.count({ where: { matchDayId: data.match.id } })).toBe(4);
  } finally { await cleanup(data); }
});

test("missing credited team can be chosen in the dialog before manual ranking", async ({ page }) => {
  const data = await fixture();
  data.rawText = `第一节白蓝1:1${data.names.guest}临时代打进球，${data.names.own}乌龙\n第二节白红1:0\n第三节红蓝0:1\n第四节白蓝1:1\n第五节白红1:0\n第六节红蓝0:1`;
  try {
    await login(page);
    await parseFixture(page, data);
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "特殊比赛事件确认" });
    await expect(dialog).toBeVisible();
    const continueButton = dialog.getByRole("button", { name: "确认特殊事件并继续" });
    await expect(continueButton).toBeDisabled();
    // The own-goal parser puts its event first; the unresolved guest is second.
    await selectOption(page, "确认第1节事件2得分队", "白队");
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    const rankings = page.getByRole("dialog", { name: "人工确认三队排名" });
    await expect(rankings).toBeVisible();
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(0);
    await rankings.getByRole("button", { name: "返回修改比分" }).click();
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    await continueButton.click();
    await expect(rankings).toBeVisible();
    await selectOption(page, "白队排名", "第 1 名");
    await selectOption(page, "蓝队排名", "第 2 名");
    await selectOption(page, "红队排名", "第 3 名");
    await rankings.getByRole("button", { name: "确认排名并入库" }).click();
    await page.waitForURL(`**/matchdays/${data.match.id}/share`);
    const goals = await prisma.goalEvent.findMany({ where: { matchDayId: data.match.id } });
    expect(goals.find((event) => event.scorerId === data.ids.guest)).toMatchObject({ teamColor: "WHITE", scorerRosterTeam: "RED" });
    const points = await prisma.playerMatchdayPoint.findMany({ where: { matchDayId: data.match.id } });
    expect(points.find((row) => row.playerId === data.ids.guest)?.basePoints).toBe(1);
    expect(points.find((row) => row.playerId === data.ids.absent)?.basePoints).toBe(2);
  } finally { await cleanup(data); }
});

test("API rejects stale confirmations and rolls back a failed replacement", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    const parseResponse = await page.request.post(`/api/matchdays/${data.match.id}/parse`, { data: { matchType: "INTERNAL", rawText: data.rawText } });
    expect(parseResponse.ok()).toBeTruthy();
    const match = await (await page.request.get(`/api/matchdays/${data.match.id}`)).json();
    const parsed = match.parseResults[0].parsedJson;
    parsed.games[0].events[1].type = "own_goal";
    parsed.games[0].events[1].team = "blue";
    const input = { parsedJson: parsed, matchDayVersion: match.updatedAt };
    const url = `/api/matchdays/${data.match.id}/confirm`;
    const pending = await page.request.post(url, { data: input });
    expect(pending.status()).toBe(409);
    const { confirmationToken } = await pending.json();
    const changed = structuredClone(input);
    changed.parsedJson.games[0].events[0].count = 2;
    changed.parsedJson.games[0].scoreB = 3;
    const stale = await page.request.post(url, { data: { ...changed, eventConfirmationToken: confirmationToken } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("MATCH_EVENT_CONFIRMATION_REQUIRED");
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(0);
    const success = await page.request.post(url, { data: { ...input, eventConfirmationToken: confirmationToken } });
    expect(success.ok()).toBeTruthy();
    const before = await prisma.goalEvent.findMany({ where: { matchDayId: data.match.id }, orderBy: { id: "asc" } });
    const changedVersion = await page.request.post(url, { data: { ...input, eventConfirmationToken: confirmationToken } });
    expect(changedVersion.status()).toBe(409);
    expect((await changedVersion.json()).code).toBe("MATCH_DAY_CHANGED");
    input.matchDayVersion = (await success.json()).updatedAt;
    parsed.awards = [{ name: "最佳后卫", players: [{ playerId: "does-not-exist", rawName: "测试未知球员", confidence: 1 }], points: 0, rawText: "" }];
    const failedPreview = await page.request.post(url, { data: input });
    expect(failedPreview.status()).toBe(409);
    const freshToken = (await failedPreview.json()).confirmationToken;
    const failed = await page.request.post(url, { data: { ...input, eventConfirmationToken: freshToken } });
    expect(failed.ok()).toBe(false);
    expect(await prisma.goalEvent.findMany({ where: { matchDayId: data.match.id }, orderBy: { id: "asc" } })).toEqual(before);
  } finally { await cleanup(data); }
});

test("new and moved events are checked again and guest own goals clear assists", async ({ page }) => {
  const data = await fixture();
  data.rawText = "第一节白蓝0:2\n第二节白红0:1\n第三节红蓝1:0\n第四节白蓝0:0\n第五节白红0:1\n第六节红蓝1:0";
  try {
    await login(page);
    await parseFixture(page, data);
    await page.getByRole("button", { name: "新增进球", exact: true }).click();
    await selectOption(page, "第1节事件1球员", data.names.guest);
    await selectOption(page, "第1节事件1助攻", data.names.helper);
    await selectOption(page, "第1节事件1得分队", "白队");
    await page.getByRole("button", { name: "第1节事件1转为乌龙球", exact: true }).click();
    const conversion = page.getByRole("dialog").filter({ hasText: "转为乌龙球" });
    await conversion.getByRole("button", { name: /取\s*消|返回/ }).click();
    await expect(page.getByRole("combobox", { name: "第1节事件1助攻", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "第1节事件1转为乌龙球", exact: true }).click();
    await expect(conversion).toContainText("转换后将清空助攻");
    await conversion.getByRole("button", { name: "确认转换", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "第1节事件1助攻", exact: true })).toHaveCount(0);

    await selectOption(page, "第1节事件1节次", "第 4 节");
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    await expect(page.getByText("第 4 节已记录进球超过对应队伍比分，请检查得分队、进球数量或比分", { exact: true })).toBeVisible();
    expect(await prisma.goalEvent.count({ where: { matchDayId: data.match.id } })).toBe(0);
    await selectOption(page, "第4节事件1节次", "第 1 节");
    await page.getByRole("button", { name: "确认入库", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "特殊比赛事件确认" });
    await expect(dialog.getByText(/当天属于红队.*本次代表白队/)).toBeVisible();
    await dialog.getByRole("button", { name: "确认特殊事件并继续" }).click();
    await page.waitForURL(`**/matchdays/${data.match.id}/share`);
    await expect(page.getByText(`${data.names.guest}（代打、乌龙）`, { exact: true })).toBeVisible();
    const goal = await prisma.goalEvent.findFirstOrThrow({ where: { matchDayId: data.match.id } });
    expect(goal).toMatchObject({ kind: "OWN_GOAL", teamColor: "BLUE", scorerRosterTeam: "RED", assistPlayerId: null });
  } finally { await cleanup(data); }
});
