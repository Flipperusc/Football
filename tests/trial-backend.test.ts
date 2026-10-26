import { describe, expect, it } from "vitest";
import { inspectInternalEvents } from "@/lib/match-events";
import { internalParseResultSchema, matchedPlayerSchema } from "@/lib/ai/schemas";
import { createEventConfirmation, verifyEventConfirmation } from "@/lib/server/event-confirmation";
const trial = { id: "trial-a", name: "试训甲", confirmed: true };
const assignments = [{ playerId: "p", teamColor: "BLUE" as const, pointsEligible: true }];
const parsed = () => internalParseResultSchema.parse({ matchType: "internal", games: [{ sectionNo: 1, teamA: "white", teamB: "blue", scoreA: 0, scoreB: 1, rawText: "", events: [{ type: "goal", team: "blue", scorer: { playerId: null, trialPlayerId: trial.id, rawName: trial.name, confidence: 1 }, assist: { playerId: "p", rawName: "正式", confidence: 1 }, count: 1, rawText: "" }] }] });
describe("trial event contracts", () => {
  it("accepts a trial scorer with a formal assist without inventing a roster", () => {
    const result = inspectInternalEvents(parsed(), assignments, [trial]);
    expect(result.issues).toEqual([]);
    expect(result.resolutions[0]).toMatchObject({ scorerRosterTeam: null, assistRosterTeam: "BLUE", teamColor: "BLUE" });
  });
  it("blocks pending identities including trial names without events", () => {
    expect(inspectInternalEvents(parsed(), assignments, [{ ...trial, confirmed: false }]).issues.join()).toContain("试训");
    const empty = parsed(); empty.games[0].events = [];
    expect(inspectInternalEvents(empty, assignments, [{ ...trial, confirmed: false }]).issues.join()).toContain("确认");
  });
  it("rejects unknown trial references and dual identities", () => {
    expect(inspectInternalEvents(parsed(), assignments, []).issues.join()).toContain("试训");
    expect(matchedPlayerSchema.safeParse({ playerId: "p", trialPlayerId: trial.id, rawName: "", confidence: 1 }).success).toBe(false);
  });
  it("requires explicit beneficiary for a trial goal", () => {
    const value = parsed(); delete value.games[0].events[0].team;
    expect(inspectInternalEvents(value, assignments, [trial]).exceptions[0].reasons).toContain("TEAM_REQUIRED");
  });
  it("binds trial identity and points eligibility into the confirmation", () => {
    const context = { matchDayId: "m", updatedAt: new Date(), parsed: parsed(), assignments, trialPlayers: [trial] };
    const token = createEventConfirmation(context);
    expect(verifyEventConfirmation(token, context)).toBe(true);
    expect(verifyEventConfirmation(token, { ...context, assignments: [{ ...assignments[0], teamColor: "RED" }] })).toBe(false);
    expect(verifyEventConfirmation(token, { ...context, trialPlayers: [{ ...trial, name: "changed" }] })).toBe(false);
  });
});

import { vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { confirmMatchDay } from "@/lib/server/confirm-matchday";
import { localParseMatch } from "@/lib/ai/local-parser";
import { preserveConfirmedParticipants, confirmedParticipantRecognition } from "@/lib/ai/preserve-confirmed-participants";
const trialId = "c35ac3b2-27b0-467b-bae2-3fa238f6ff41";
function databaseFixture() {
  const data = { id: "m", updatedAt: new Date(), rawText: "", type: "INTERNAL", assignments: [{ matchDayId: "m", playerId: "p", teamColor: "BLUE", pointsEligible: true }], trialPlayers: [{ ...trial, id: trialId, matchDayId: "m" }] };
  const tx = {
    player: { findMany: vi.fn(async () => [{ id: "p", name: "正式", aliases: [] }]) },
    matchDay: { findUnique: vi.fn(async () => data), update: vi.fn(async (_args: { data: { participantCorrections: { rawName: string; playerId: string }[] } }) => data) },
    trialPlayer: { findMany: vi.fn(async () => data.trialPlayers), deleteMany: vi.fn(), upsert: vi.fn() },
    goalEvent: { deleteMany: vi.fn(), create: vi.fn() },
    playerMatchdayPoint: { deleteMany: vi.fn(), createMany: vi.fn() },
    teamMatchdayResult: { deleteMany: vi.fn(), createMany: vi.fn() },
    award: { deleteMany: vi.fn(), create: vi.fn() },
    internalGame: { deleteMany: vi.fn(), create: vi.fn(async ({data}) => ({ ...data, id: "game" })) },
    teamAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
    matchParseResult: { create: vi.fn() }
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaClient;
  const value = parsed(); value.games[0].events[0].scorer.trialPlayerId = trialId;
  return { data, tx, prisma, input: { matchDayId: "m", parsedJson: value, trialPlayers: [{ ...trial, id: trialId }] } };
}
describe("trial persistence", () => {
  it("stores dedicated trial foreign keys and formal assists only after secondary confirmation", async () => {
    const f = databaseFixture();
    const pending = await confirmMatchDay(f.prisma, f.input).catch((e) => e);
    expect(pending.code).toBe("MATCH_EVENT_CONFIRMATION_REQUIRED");
    expect(f.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
    await confirmMatchDay(f.prisma, { ...f.input, eventConfirmationToken: pending.confirmationToken });
    expect(f.tx.goalEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ scorerId: null, scorerTrialPlayerId: trialId, assistPlayerId: "p", assistTrialPlayerId: null, teamColor: "BLUE" }) });
    expect(f.tx.goalEvent.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(f.tx.trialPlayer.deleteMany.mock.invocationCallOrder[0]);
    expect(f.tx.playerMatchdayPoint.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ playerId: "p" })], skipDuplicates: true });
  });
  it("rejects a supplied trial ID owned by another match before deletes", async () => {
    const f = databaseFixture(); f.tx.trialPlayer.findMany.mockResolvedValue([{ ...f.data.trialPlayers[0], matchDayId: "other" }]);
    await expect(confirmMatchDay(f.prisma, f.input)).rejects.toThrow("其他比赛日");
    expect(f.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
  });
  it("rejects trial own goals with any assist", async () => {
    const f = databaseFixture(); f.input.parsedJson.games[0].events[0].type = "own_goal";
    await expect(confirmMatchDay(f.prisma, f.input)).rejects.toThrow("乌龙球不计助攻");
    expect(f.tx.goalEvent.deleteMany).not.toHaveBeenCalled();
  });
  it("ignores retired exclusions and includes base, text bonus and award points", async () => {
    const f = databaseFixture();
    f.input.parsedJson.awards = [{ name: "最佳球员", players: [{ playerId: "p", rawName: "正式", confidence: 1, candidates: [] }], points: 2, rawText: "" }];
    f.input.parsedJson.bonusPoints = [{ player: { playerId: "p", rawName: "正式", confidence: 1, candidates: [] }, points: 1, reason: "奖励", rawText: "" }];
    const input = { ...f.input, teamAssignments: [{ playerId: "p", teamColor: "BLUE" as const, pointsEligible: false }] };
    const pending = await confirmMatchDay(f.prisma, input).catch((e) => e);
    await confirmMatchDay(f.prisma, { ...input, eventConfirmationToken: pending.confirmationToken });
    expect(f.tx.playerMatchdayPoint.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ playerId: "p", basePoints: 3, bonusPoints: 3, totalPoints: 6 })], skipDuplicates: true });
    expect(f.tx.award.create).toHaveBeenCalledWith({ data: expect.objectContaining({ playerId: "p", points: 2 }) });
  });
});
describe("trial parsing", () => {
  it("recognizes local trial scorer and helper without fake formal IDs", () => {
    const result = localParseMatch({ rawText: "第一节白蓝0:1，正式助攻试训甲进球", matchType: "INTERNAL", players: [{ id: "p", name: "正式", aliases: [] }], teamAssignments: assignments, trialPlayers: [trial] });
    expect(result.matchType).toBe("internal");
    if (result.matchType !== "internal") return;
    expect(result.games[0].events[0]).toMatchObject({ scorer: { playerId: null, trialPlayerId: trial.id }, assist: { playerId: "p" } });
  });
  it("preserves manually corrected formal identity across a reparse", () => {
    const old = parsed(); old.games[0].events[0].scorer = { playerId: "p", rawName: trial.name, matchedName: "正式", confidence: 1, candidates: [] };
    const next = preserveConfirmedParticipants(parsed(), old, [trial]);
    if (next.matchType !== "internal") return;
    expect(next.games[0].events[0].scorer.playerId).toBe("p");
    expect(next.games[0].events[0].scorer.trialPlayerId).toBeUndefined();
    expect(next.uncertainItems[0].reason).toContain("保留");
  });
});

describe("durable confirmation drafts", () => {
  it("uses saved draft identities and qualifications, clears drafts only on success", async () => {
    const f = databaseFixture();
    Object.assign(f.data, { draftAssignments: [{ playerId: "p", teamColor: "BLUE", pointsEligible: false }], draftTrialPlayers: f.input.trialPlayers });
    f.data.trialPlayers = [];
    const input = { matchDayId: "m", parsedJson: f.input.parsedJson };
    const pending = await confirmMatchDay(f.prisma, input).catch((e) => e);
    expect(pending.code).toBe("MATCH_EVENT_CONFIRMATION_REQUIRED");
    expect(f.tx.matchDay.update).not.toHaveBeenCalled();
    await confirmMatchDay(f.prisma, { ...input, eventConfirmationToken: pending.confirmationToken });
    expect(f.tx.trialPlayer.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ id: trialId, matchDayId: "m" }) }));
    expect(f.tx.teamAssignment.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ pointsEligible: true })] }));
    expect(f.tx.playerMatchdayPoint.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ totalPoints: 3 })] }));
    expect(f.tx.matchDay.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ draftAssignments: expect.anything(), draftTrialPlayers: expect.anything(), parseStatus: "CONFIRMED" }) }));
  });
});

import { applyParticipantCorrections } from "@/lib/ai/participant-corrections";
import { assertParticipantCorrections } from "@/lib/server/participant-corrections";
describe("match scoped roster corrections", () => {
  it("applies explicit corrected names after previous manual identity replay", () => {
    const value = applyParticipantCorrections(parsed(), [{ rawName: trial.name, playerId: "p" }]);
    if (value.matchType !== "internal") return;
    expect(value.games[0].events[0].scorer).toMatchObject({ playerId: "p", trialPlayerId: null, confidence: 1 });
  });
  it("accepts real unassigned formal players and rejects another person's exact name", async () => {
    const tx = { player: { findMany: vi.fn(async () => [{ id: "p", name: "正式", aliases: [] }, { id: "other", name: "别人", aliases: [] }]) } };
    await expect(assertParticipantCorrections(tx as never, [{ rawName: "试训名", playerId: "p" }], [], "INTERNAL")).resolves.toBeUndefined();
    await expect(assertParticipantCorrections(tx as never, [{ rawName: "别人", playerId: "p" }], assignments, "INTERNAL")).rejects.toThrow("其他正式球员");
    await expect(assertParticipantCorrections(tx as never, [{ rawName: "试训名", playerId: "p" }], assignments, "INTERNAL")).resolves.toBeUndefined();
  });
});

describe("confirmed identity supersedes entry corrections", () => {
  it.each(["formal", "trial", "ambiguous"])("retires consumed name mappings after %s identity confirmation", async (kind) => {
    const f = databaseFixture();
    Object.assign(f.data, { participantCorrections: [{ rawName: trial.name, playerId: "old-A" }, { rawName: "尚未发生事件", playerId: "p" }] });
    if (kind === "formal") f.input.parsedJson.games[0].events[0].scorer = { playerId: "p", rawName: trial.name, confidence: 1, candidates: [] };
    if (kind === "ambiguous") {
      const another = structuredClone(f.input.parsedJson.games[0].events[0]);
      another.scorer = { playerId: "p", rawName: trial.name, confidence: 1, candidates: [] };
      f.input.parsedJson.games[0].events.push(another);
      f.input.parsedJson.games[0].scoreB = 2;
    }
    const pending = await confirmMatchDay(f.prisma, f.input).catch((e) => e);
    expect(f.tx.matchDay.update).not.toHaveBeenCalled();
    await confirmMatchDay(f.prisma, { ...f.input, eventConfirmationToken: pending.confirmationToken });
    const saved = f.tx.matchDay.update.mock.calls[0][0].data;
    expect(saved.participantCorrections).toEqual([{ rawName: "尚未发生事件", playerId: "p" }]);
    const reparsed = parsed();
    reparsed.games[0].events[0].scorer = { playerId: "old-A", rawName: trial.name, confidence: 1, candidates: [] };
    const previous = f.tx.matchParseResult.create.mock.calls[0][0].data.parsedJson;
    const restored = applyParticipantCorrections(preserveConfirmedParticipants(reparsed, previous, f.input.trialPlayers), saved.participantCorrections);
    if (restored.matchType !== "internal") throw new Error("Expected internal parse result");
    const person = restored.games[0].events[0].scorer;
    expect(person.playerId).toBe(kind === "formal" ? "p" : null);
    expect(person.trialPlayerId ?? null).toBe(kind === "trial" ? trialId : null);
    if (kind === "ambiguous") expect(restored.uncertainItems.some((row) => row.reason.includes("冲突"))).toBe(true);
  });
});

it.each(["formal", "trial"])("recognizes a noncanonical confirmed %s name after entry hint retirement", (kind) => {
  const old = parsed();
  old.games[0].events[0].scorer = { playerId: kind === "formal" ? "p" : null, trialPlayerId: kind === "trial" ? trial.id : null, rawName: "小新人", confidence: 1, candidates: [] };
  const recognition = confirmedParticipantRecognition(old, [{ id: "p", name: "正式姓名", aliases: [] }], [trial]);
  const reparsed = localParseMatch({ rawText: "第一节白蓝0:1，小新人进球", matchType: "INTERNAL", players: recognition.players, trialPlayers: recognition.trials, teamAssignments: assignments });
  if (reparsed.matchType !== "internal") throw new Error("Expected internal result");
  expect(reparsed.games[0].events).toHaveLength(1);
  expect(reparsed.games[0].events[0].scorer).toMatchObject({ rawName: "小新人", playerId: kind === "formal" ? "p" : null });
  if (kind === "trial") expect(reparsed.games[0].events[0].scorer.trialPlayerId).toBe(trial.id);
});
