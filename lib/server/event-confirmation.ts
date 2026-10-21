import { createHmac, timingSafeEqual } from "node:crypto";
import { getAdminSessionToken } from "@/lib/admin-auth";
import type { ParseResult } from "@/lib/ai/schemas";
import type { EventAssignment, EventException, TrialParticipant } from "@/lib/match-events";

type ConfirmationContext = {
  matchDayId: string;
  updatedAt: Date;
  parsed: ParseResult;
  assignments: EventAssignment[];
  trialPlayers?: TrialParticipant[];
};

function signature(issuedAt: string, context: ConfirmationContext) {
  const assignments = context.assignments.map(({ playerId, teamColor }) => ({ playerId, teamColor }))
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
  return createHmac("sha256", getAdminSessionToken()).update(JSON.stringify({
    purpose: "match-event-confirmation-v1", issuedAt,
    matchDayId: context.matchDayId, updatedAt: context.updatedAt, parsed: context.parsed, assignments,
    trialPlayers: (context.trialPlayers ?? []).map(({ id, name, confirmed }) => ({ id, name, confirmed })).sort((a, b) => a.id.localeCompare(b.id))
  })).digest("hex");
}

export function createEventConfirmation(context: ConfirmationContext) {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${signature(issuedAt, context)}`;
}

export function verifyEventConfirmation(token: string | undefined, context: ConfirmationContext) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return false;
  const age = Date.now() - Number(parts[0]);
  if (age < 0 || age > 30 * 60 * 1000) return false;
  return timingSafeEqual(Buffer.from(parts[1], "hex"), Buffer.from(signature(parts[0], context), "hex"));
}

export class EventConfirmationRequired extends Error {
  readonly status = 409;
  readonly code = "MATCH_EVENT_CONFIRMATION_REQUIRED";

  constructor(readonly exceptions: EventException[], readonly confirmationToken?: string) {
    super("请复核试训身份及特殊事件，确认统计影响后继续入库");
    this.name = "EventConfirmationRequired";
  }
}

export class MatchDayChanged extends Error {
  readonly code = "MATCH_DAY_CHANGED";
  constructor() {
    super("比赛已被其他操作更新，请重新加载后确认");
    this.name = "MatchDayChanged";
  }
}
