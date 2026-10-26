import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient({ datasources: { db: { url: process.env.E2E_DATABASE_URL } } });
async function fixture() {
  const suffix = [...randomUUID().replace(/-/g, "").slice(0, 8)].map((c) => "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳"[parseInt(c, 16)]).join("");
  const names = { red: `正甲${suffix}`, blue: `正乙${suffix}`, white: `正丙${suffix}`, guest: `正丁${suffix}`, helper: `正戊${suffix}`, trial: `新人${suffix}` };
  const players = await Promise.all(Object.entries(names).filter(([key]) => key !== "trial").map(async ([key, name]) => ({ key, ...await prisma.player.create({ data: { name } }) })));
  const ids = Object.fromEntries(players.map((player) => [player.key, player.id]));
  const season = await prisma.season.create({ data: { name: `名单外 E2E ${suffix}`, startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31") } });
  const assignments = [{ playerId: ids.red, teamColor: "RED" }, { playerId: ids.blue, teamColor: "BLUE" }, { playerId: ids.white, teamColor: "WHITE" }];
  const tail = "\n第二节白红0:1\n第三节红蓝1:0\n第四节白蓝0:0\n第五节白红0:1\n第六节红蓝1:0";
  const rawText = `第一节白蓝0:3，${names.helper}助攻${names.guest}替蓝队进球，${names.blue}助攻${names.trial}替蓝队进球，${names.trial}助攻${names.blue}进球${tail}`;
  return { names, ids, players, season, assignments, rawText, tail, suffix };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function cleanup(data: Fixture) {
  await prisma.matchDay.deleteMany({ where: { seasonId: data.season.id } });
  await prisma.season.delete({ where: { id: data.season.id } });
  await prisma.player.deleteMany({ where: { name: { endsWith: data.suffix } } });
}
async function login(page: Page) {
  const response = await page.request.post("/api/admin/login", { data: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } });
  expect(response.ok()).toBeTruthy();
  if (process.env.E2E_USE_BUILD === "1") await page.context().setExtraHTTPHeaders({ Cookie: response.headers()["set-cookie"].split(";")[0] });
}
async function createMatch(request: APIRequestContext, data: Fixture, extra = {}) {
  const response = await request.post("/api/matchdays", { data: { seasonId: data.season.id, date: "2026-10-25", type: "INTERNAL", assignments: data.assignments, ...extra } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function parse(request: APIRequestContext, matchId: string, rawText: string) {
  expect((await request.post(`/api/matchdays/${matchId}/parse`, { data: { matchType: "INTERNAL", rawText } })).ok()).toBeTruthy();
  return (await request.get(`/api/matchdays/${matchId}`)).json();
}
async function saveUi(page: Page, id: string, editing = false) {
  await page.getByRole("button", { name: editing ? "保存修改并重新入库" : "确认入库", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "特殊比赛事件确认", exact: true });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("不增加出勤和排名积分");
  await modal.getByRole("button", { name: "确认特殊事件并继续" }).click();
  await page.waitForURL(`**/matchdays/${id}/share`);
}
async function seasonStats(request: APIRequestContext, data: Fixture) {
  const response = await request.get(`/api/stats/season/${data.season.id}/players`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Array<{ playerId: string; internalGoals: number; internalAssists: number; internalAppearances: number; internalSeasonPoints: number }>>;
}
test.afterAll(() => prisma.$disconnect());

test("UI records off-roster guests and promotes every trial role, recovering from a failed request", async ({ page }, testInfo) => {
  const data = await fixture();
  try {
    await login(page);
    const match = await createMatch(page.request, data);
    await page.goto(`/matchdays/internal?edit=${match.id}`);
    await expect(page.getByText("正在修改已解析的比赛日", { exact: true })).toBeVisible();
    await page.getByLabel(/赛后文本/).fill(data.rawText);
    await page.getByRole("button", { name: "保存修改并重新解析", exact: true }).click();
    await page.waitForURL(`**/matchdays/${match.id}/confirm`);
    const prompt = page.getByRole("dialog", { name: "发现未加入正式名单的球员", exact: true });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(data.names.trial);
    await page.screenshot({ path: testInfo.outputPath("trial-identity-prompt.png"), fullPage: false, animations: "disabled" });
    const nameInput = prompt.getByRole("textbox", { name: `正式姓名${data.names.trial}` });
    await nameInput.fill(data.names.blue);
    await expect(prompt.getByRole("button", { name: "加入正式名单", exact: true })).toBeDisabled();
    await nameInput.fill(data.names.trial);
    await page.route("**/api/players/resolve-trial", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "测试暂时失败，请重试" }) }), { times: 1 });
    await prompt.getByRole("button", { name: "加入正式名单", exact: true }).click();
    await expect(prompt).toContainText("测试暂时失败，请重试");
    expect(await prisma.player.count({ where: { name: data.names.trial } })).toBe(0);
    await prompt.getByRole("button", { name: "加入正式名单", exact: true }).click();
    await expect(prompt).toBeHidden();
    const promoted = await prisma.player.findUniqueOrThrow({ where: { name: data.names.trial } });
    await page.reload();
    await expect(page.getByRole("region", { name: "试训球员", exact: true })).toContainText("暂无试训球员");
    await expect(page.getByText("正式球员 · 当天未分队 · 代打", { exact: true }).first()).toBeVisible();
    await saveUi(page, match.id);
    const events = await prisma.goalEvent.findMany({ where: { matchDayId: match.id } });
    expect(events).toHaveLength(3);
    expect(events.find((event) => event.scorerId === data.ids.guest)).toMatchObject({ assistPlayerId: data.ids.helper, scorerIsGuest: true, assistIsGuest: true, scorerRosterTeam: null, assistRosterTeam: null });
    expect(events.some((event) => event.scorerId === promoted.id)).toBe(true);
    expect(events.some((event) => event.assistPlayerId === promoted.id)).toBe(true);
    expect(await prisma.teamAssignment.count({ where: { matchDayId: match.id } })).toBe(3);
    const stats = await seasonStats(page.request, data);
    expect(stats.find((row) => row.playerId === data.ids.guest)).toMatchObject({ internalGoals: 1, internalAssists: 0, internalAppearances: 0, internalSeasonPoints: 0 });
    expect(stats.find((row) => row.playerId === data.ids.helper)).toMatchObject({ internalGoals: 0, internalAssists: 1, internalAppearances: 0, internalSeasonPoints: 0 });
    expect(stats.find((row) => row.playerId === promoted.id)).toMatchObject({ internalGoals: 1, internalAssists: 1, internalAppearances: 0, internalSeasonPoints: 0 });
    await expect(page.getByText(`${data.names.guest}（代打）`, { exact: false }).first()).toBeVisible();
    await page.goto(`/players/${promoted.id}`);
    await expect(page.getByRole("heading", { name: promoted.name, exact: true })).toBeVisible();
    await page.locator(".page-title .ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByText(data.season.name, { exact: true }).click();
    await expect(page.getByText("（代打）", { exact: false }).first()).toBeVisible();
    await parse(page.request, match.id, data.rawText);
    await page.goto(`/matchdays/${match.id}/confirm`);
    await expect(page.getByRole("region", { name: "试训球员", exact: true })).toContainText("暂无试训球员");
    await saveUi(page, match.id, true);
    expect(await prisma.goalEvent.count({ where: { matchDayId: match.id } })).toBe(3);
    expect(await prisma.player.count({ where: { name: data.names.trial } })).toBe(1);
  } finally { await cleanup(data); }
});

test("promotion is atomic and replayable, protects committed matches and leaves other historical trials alone", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    const trial = { id: randomUUID(), name: data.names.trial, confirmed: true };
    const match = await createMatch(page.request, data, { trialPlayers: [trial] });
    const detail = await parse(page.request, match.id, data.rawText);
    const confirmation = { parsedJson: detail.parseResults[0].parsedJson, matchDayVersion: detail.updatedAt, trialPlayers: [trial] };
    const pending = await page.request.post(`/api/matchdays/${match.id}/confirm`, { data: confirmation });
    expect(pending.status()).toBe(409);
    const proof = await pending.json();
    expect((await page.request.post(`/api/matchdays/${match.id}/confirm`, { data: { ...confirmation, eventConfirmationToken: proof.confirmationToken } })).ok()).toBeTruthy();
    const committed = await prisma.goalEvent.findMany({ where: { matchDayId: match.id }, orderBy: { id: "asc" } });
    const historicalTrial = { ...trial, id: randomUUID() };
    const history = await createMatch(page.request, data, { trialPlayers: [historicalTrial] });
    const current = await (await page.request.get(`/api/matchdays/${match.id}`)).json();
    const request = { trialId: trial.id, trialPlayers: [trial], name: trial.name, matchDayId: match.id, matchDayVersion: current.updatedAt, parsedJson: current.parseResults[0].parsedJson };
    const resolved = await page.request.post("/api/players/resolve-trial", { data: request });
    expect(resolved.ok(), await resolved.text()).toBeTruthy();
    const result = await resolved.json();
    const replay = await page.request.post("/api/players/resolve-trial", { data: request });
    expect(replay.ok()).toBeTruthy();
    expect((await replay.json()).player.id).toBe(result.player.id);
    const editedDraft = structuredClone(request.parsedJson);
    editedDraft.games[0].scoreB = 4;
    editedDraft.games[0].events[1].count = 2;
    const extraTrial = { id: randomUUID(), name: `另试${data.suffix}`, confirmed: true };
    const editedReplay = await page.request.post("/api/players/resolve-trial", { data: { ...request, parsedJson: editedDraft, trialPlayers: [trial, extraTrial] } });
    expect(editedReplay.ok(), await editedReplay.text()).toBeTruthy();
    const recovered = await editedReplay.json();
    expect(recovered.parsedJson.games[0].scoreB).toBe(4);
    expect(recovered.trialPlayers).toEqual([extraTrial]);
    expect(recovered.matchDayVersion).toBe(result.matchDayVersion);
    expect(await prisma.player.count({ where: { name: trial.name } })).toBe(1);
    expect(await prisma.goalEvent.findMany({ where: { matchDayId: match.id }, orderBy: { id: "asc" } })).toEqual(committed);
    expect(await prisma.trialPlayer.count({ where: { id: trial.id } })).toBe(1);
    expect(await prisma.trialPlayer.count({ where: { matchDayId: history.id, id: historicalTrial.id } })).toBe(1);
    expect((await seasonStats(page.request, data)).find((row) => row.playerId === result.player.id)).toMatchObject({ internalGoals: 0, internalAssists: 0 });
    await page.goto(`/matchdays/${match.id}/confirm`);
    await page.getByRole("button", { name: "保存修改并重新入库", exact: true }).click();
    await page.getByRole("dialog", { name: "特殊比赛事件确认" }).getByRole("button", { name: "返回修改", exact: true }).click();
    expect(await prisma.goalEvent.findMany({ where: { matchDayId: match.id }, orderBy: { id: "asc" } })).toEqual(committed);
    await saveUi(page, match.id, true);
    expect((await seasonStats(page.request, data)).find((row) => row.playerId === result.player.id)).toMatchObject({ internalGoals: 1, internalAssists: 1, internalAppearances: 0, internalSeasonPoints: 0 });
    expect((await page.request.post("/api/players/resolve-trial", { data: request })).status()).toBe(409);

    const rollbackTrial = { id: randomUUID(), name: `回滚${data.suffix}`, confirmed: false };
    const rollback = await page.request.post("/api/players/resolve-trial", { data: { trialId: rollbackTrial.id, trialPlayers: [rollbackTrial], name: rollbackTrial.name, participantCorrections: [{ rawName: "无效引用", playerId: "missing-player" }] } });
    expect(rollback.ok()).toBe(false);
    expect(await prisma.player.count({ where: { name: rollbackTrial.name } })).toBe(0);
    expect(await prisma.trialResolution.count({ where: { id: rollbackTrial.id } })).toBe(0);
    const foreign = await page.request.post("/api/players/resolve-trial", { data: { trialId: historicalTrial.id, trialPlayers: [historicalTrial], name: `跨场${data.suffix}` } });
    expect(foreign.ok()).toBe(false);
    expect(await prisma.player.count({ where: { name: `跨场${data.suffix}` } })).toBe(0);
    const concurrentTrial = { id: randomUUID(), name: `并发${data.suffix}`, confirmed: false };
    const concurrentBody = { trialId: concurrentTrial.id, trialPlayers: [concurrentTrial], name: concurrentTrial.name };
    const concurrent = await Promise.all([page.request.post("/api/players/resolve-trial", { data: concurrentBody }), page.request.post("/api/players/resolve-trial", { data: concurrentBody })]);
    expect(concurrent.every((response) => response.ok())).toBe(true);
    expect((await concurrent[0].json()).player.id).toBe((await concurrent[1].json()).player.id);
  } finally { await cleanup(data); }
});

test("unsaved roster promotion preserves its edited name across re-recognition without a global alias", async ({ page }, testInfo) => {
  const data = await fixture();
  try {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/matchdays/internal");
    const seasonInput = page.getByRole("combobox", { name: /赛季/ });
    await page.locator(".ant-select").filter({ has: seasonInput }).locator(".ant-select-selector").click();
    await page.locator(".ant-select-dropdown:visible").getByText(data.season.name, { exact: true }).click();
    await page.getByLabel(/日期/).fill("2026-10-25");
    const originalName = `试训${data.suffix}`;
    const formalName = `新正${data.suffix}`;
    const keptName = `保留${data.suffix}`;
    await page.getByPlaceholder(/^红\n/).fill(`红\n${data.names.red}\n蓝\n${data.names.blue}\n${originalName}\n${keptName}\n白\n${data.names.white}`);
    const recognize = page.getByRole("button", { name: "DeepSeek 识别文本并填入阵容", exact: true });
    await recognize.click();
    const prompt = page.getByRole("dialog", { name: "发现未加入正式名单的球员", exact: true });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(originalName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.screenshot({ path: testInfo.outputPath("trial-identity-prompt-mobile.png"), animations: "disabled" });
    await prompt.getByRole("textbox", { name: `正式姓名${originalName}` }).fill(formalName);
    await prompt.getByRole("region", { name: `处理身份${originalName}`, exact: true }).getByRole("button", { name: "加入正式名单", exact: true }).click();
    await expect(prompt.getByRole("region", { name: `处理身份${originalName}`, exact: true })).toHaveCount(0);
    await expect(prompt).toContainText(keptName);
    await prompt.getByRole("button", { name: "保留试训", exact: true }).click();
    await expect(prompt).toBeHidden();
    const promoted = await prisma.player.findUniqueOrThrow({ where: { name: formalName }, include: { aliases: true } });
    expect(promoted.aliases).toHaveLength(0);
    await expect(page.locator(".ant-select-selection-item").filter({ hasText: formalName })).toHaveCount(0);
    await recognize.click();
    await expect(page.locator(".ant-select-selection-item").filter({ hasText: formalName })).toHaveCount(1);
    await expect(prompt).toBeHidden();
    const trialPanel = page.getByRole("region", { name: "试训球员", exact: true });
    await expect(trialPanel).toContainText(keptName);
    await expect(trialPanel.getByRole("row").filter({ hasText: originalName })).toHaveCount(0);
    await page.getByLabel(/赛后文本/).fill(data.rawText.split(data.names.trial).join(originalName));
    await page.getByRole("button", { name: "保存并解析", exact: true }).click();
    await page.waitForURL(/\/matchdays\/[^/]+\/confirm$/);
    const matchId = page.url().split("/").at(-2)!;
    await expect(prompt).toBeHidden();
    await expect(trialPanel).toContainText(keptName);
    await expect(trialPanel.getByRole("row").filter({ hasText: originalName })).toHaveCount(0);
    await saveUi(page, matchId);
    expect((await seasonStats(page.request, data)).find((row) => row.playerId === promoted.id)).toMatchObject({ internalGoals: 1, internalAssists: 1, internalAppearances: 1, internalSeasonPoints: 2 });
    expect(await prisma.player.count({ where: { name: originalName } })).toBe(0);
  } finally { await cleanup(data); }
});

test("the reminder allows keeping trial identity without creating a global player", async ({ page }) => {
  const data = await fixture();
  try {
    await login(page);
    const match = await createMatch(page.request, data);
    await parse(page.request, match.id, data.rawText);
    await page.goto(`/matchdays/${match.id}/confirm`);
    const prompt = page.getByRole("dialog", { name: "发现未加入正式名单的球员", exact: true });
    await prompt.getByRole("button", { name: "保留试训", exact: true }).click();
    await expect(prompt).toBeHidden();
    await saveUi(page, match.id);
    expect(await prisma.player.count({ where: { name: data.names.trial } })).toBe(0);
    expect(await prisma.trialPlayer.count({ where: { matchDayId: match.id, confirmed: true } })).toBe(1);
    expect((await seasonStats(page.request, data)).find((row) => row.playerId === data.ids.blue)).toMatchObject({ internalGoals: 1, internalAssists: 1 });
    await page.goto(`/matchdays/${match.id}/confirm`);
    await expect(page.getByRole("region", { name: "试训球员", exact: true })).toContainText(data.names.trial);
    await expect(prompt).toBeHidden();
  } finally { await cleanup(data); }
});
