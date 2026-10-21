import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: {
  matchDay: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  teamAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
  trialPlayer: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  player: { findMany: vi.fn() }, $transaction: vi.fn()
} }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
import { GET, PATCH } from "@/app/api/matchdays/[id]/route";
const trial = { id: "08cf5368-d15d-4af4-bf3f-4fe9f020a355", name: "试训甲", confirmed: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.$transaction.mockImplementation(async (fn) => fn(mocks.db));
  mocks.db.trialPlayer.findMany.mockResolvedValue([]);
  mocks.db.matchDay.update.mockImplementation(async ({data}) => ({ id: "m", ...data }));
});
describe("confirmed match draft API", () => {
  it("saves intended trial and eligibility edits without touching published relations", async () => {
    mocks.db.matchDay.findUniqueOrThrow.mockResolvedValue({ id: "m", type: "INTERNAL", confirmedAt: new Date(), assignments: [{ playerId: "p", teamColor: "BLUE", pointsEligible: true }] });
    const response = await PATCH(new Request("http://localhost/api/matchdays/m", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignments: [{ playerId: "p", teamColor: "BLUE", pointsEligible: false }], trialPlayers: [trial], parseStatus: "PENDING" }) }), { params: { id: "m" } });
    expect(response.status).toBe(200);
    expect(mocks.db.teamAssignment.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.trialPlayer.upsert).not.toHaveBeenCalled();
    expect(mocks.db.matchDay.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ parseStatus: "CONFIRMED", draftAssignments: [expect.objectContaining({ pointsEligible: true })], draftTrialPlayers: [trial] }) }));
  });
  it("returns effective saved drafts to editing UI while retaining formal goal events", async () => {
    mocks.db.matchDay.findUnique.mockResolvedValue({ id: "m", assignments: [{ playerId: "p", pointsEligible: true }], trialPlayers: [], draftAssignments: [{ playerId: "p", teamColor: "BLUE", pointsEligible: false }], draftTrialPlayers: [trial], goalEvents: [{ id: "old-goal" }] });
    mocks.db.player.findMany.mockResolvedValue([{ id: "p", name: "正式" }]);
    const response = await GET(new Request("http://localhost/api/matchdays/m"), { params: { id: "m" } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.assignments[0]).toMatchObject({ playerId: "p", pointsEligible: true, player: { name: "正式" } });
    expect(body.trialPlayers[0]).toMatchObject({ ...trial, matchDayId: "m" });
    expect(body.goalEvents).toEqual([{ id: "old-goal" }]);
  });
});
