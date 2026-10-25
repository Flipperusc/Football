import { Prisma, type PrismaClient } from "@prisma/client";
import { internalParseResultSchema } from "@/lib/ai/schemas";
import { mergeParticipantCorrections, resolveTrialReferences } from "@/lib/trial-players";
import { participantCorrectionsSchema, resolveTrialSchema } from "@/lib/validations";
import { assertParticipantCorrections } from "./participant-corrections";
import { assertPlayerPayloadsAvailable, translatePlayerIdentityWriteError } from "./player-identities";
import { assertTrialPlayerScope } from "./trial-players";
import { MatchDayChanged } from "./event-confirmation";

export class TrialResolutionError extends Error {
  readonly code = "TRIAL_RESOLUTION_CONFLICT";
  constructor(message: string, readonly status = 409) { super(message); }
}

/** Creates the global identity and its recoverable match draft in one transaction. */
export async function resolveTrial(prisma: PrismaClient, input: unknown) {
  const body = resolveTrialSchema.parse(input);
  const trial = body.trialPlayers.find((row) => row.id === body.trialId)!;
  const submittedParsed = body.parsedJson === undefined ? undefined : internalParseResultSchema.parse(body.parsedJson);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Player identity triggers require READ COMMITTED. Serialize this trial's
        // requests before reading its result, and lock a saved match before the
        // version check so concurrent edits cannot slip into the draft write.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${body.trialId}, 1))`;
        if (body.matchDayId) await tx.$queryRaw`SELECT "id" FROM "MatchDay" WHERE "id" = ${body.matchDayId} FOR UPDATE`;
        const previous = await tx.trialResolution.findUnique({ where: { id: body.trialId }, include: { player: { include: { aliases: true } } } });
        const match = body.matchDayId ? await tx.matchDay.findUnique({ where: { id: body.matchDayId }, include: {
          trialPlayers: true, parseResults: { orderBy: { createdAt: "desc" }, take: 1 }
        } }) : null;
        if (body.matchDayId && !match) throw new TrialResolutionError("比赛日不存在，请重新加载", 404);
        if (match && match.type !== "INTERNAL") throw new TrialResolutionError("仅队内赛支持试训转正", 422);
        const storedCorrections = participantCorrectionsSchema.parse(match?.participantCorrections ?? []);

        if (previous) {
          if (previous.matchDayId !== (body.matchDayId ?? null) || previous.sourceName !== trial.name
            || previous.requestedName !== (body.name ?? null) || (body.playerId && previous.playerId !== body.playerId)) {
            throw new TrialResolutionError("该试训身份已处理，请重新加载后核对正式球员");
          }
          if (match && match.updatedAt.getTime() !== previous.resultVersion?.getTime()) throw new MatchDayChanged();
        }

        if (!previous && match && match.updatedAt.toISOString() !== body.matchDayVersion) throw new MatchDayChanged();
        // A pending identity from a different match can never be imported here.
        await assertTrialPlayerScope(tx, body.matchDayId ?? "unsaved", body.trialPlayers);
        let player = previous?.player;
        if (!player && body.playerId) {
          const matchedPlayer = await tx.player.findUnique({ where: { id: body.playerId }, include: { aliases: true } });
          if (!matchedPlayer) throw new TrialResolutionError("正式球员不存在，请重新加载名单", 422);
          player = matchedPlayer;
        } else if (!player) {
          const name = body.name!;
          await assertPlayerPayloadsAvailable(tx, [{ ownerId: "new:trial", name }]);
          player = await tx.player.create({ data: { name }, include: { aliases: true } }).catch((error) =>
            translatePlayerIdentityWriteError(error, [{ ownerId: "new:trial", ownerName: name, value: name, kind: "PLAYER_NAME" }])
          );
        }

        const storedParsed = internalParseResultSchema.safeParse(match?.parseResults[0]?.parsedJson);
        const parsed = submittedParsed ?? (storedParsed.success ? storedParsed.data : undefined);
        const converted = parsed ? resolveTrialReferences(parsed, body.trialId, player) : undefined;
        const rawNames = [trial.name, ...(converted?.rawNames ?? [])];
        const currentCorrections = [...new Map([...storedCorrections, ...body.participantCorrections]
          .map((row) => [row.rawName.replace(/\s+/g, "").toLowerCase(), row])).values()];
        const corrections = participantCorrectionsSchema.parse(mergeParticipantCorrections(currentCorrections, rawNames, player.id));
        await assertParticipantCorrections(tx, corrections, [], "INTERNAL");
        const trialPlayers = body.trialPlayers.filter((row) => row.id !== body.trialId);
        if (previous) {
          // Recover the committed identity without overwriting edits made after
          // a lost response. Those edits stay in the current local draft until
          // the user next saves/confirms; a replay does not write the match again.
          return { player, trialPlayers, participantCorrections: corrections,
            parsedJson: converted?.parsed, matchDayVersion: match?.updatedAt.toISOString() };
        }
        let resultVersion: Date | undefined;
        if (match) {
          if (converted) await tx.matchParseResult.create({ data: {
            matchDayId: match.id, rawText: match.rawText ?? "", parsedJson: converted.parsed,
            modelName: "trial-identity-resolution", status: "NEEDS_REVIEW"
          } });
          const saved = await tx.matchDay.update({ where: { id: match.id }, data: {
            draftTrialPlayers: trialPlayers, participantCorrections: corrections
          } });
          resultVersion = saved.updatedAt;
        }
        await tx.trialResolution.create({ data: {
          id: body.trialId, sourceName: trial.name, requestedName: body.name,
          playerId: player.id, matchDayId: match?.id, resultVersion
        } });
        return { player, trialPlayers, participantCorrections: corrections,
          parsedJson: converted?.parsed, matchDayVersion: resultVersion?.toISOString() };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if ((code === "P2034" || code === "P2002") && attempt < 2) continue;
      if (code === "P2034" || code === "P2002") throw new TrialResolutionError("身份处理发生并发冲突，请重新加载名单后重试");
      throw error;
    }
  }
}
