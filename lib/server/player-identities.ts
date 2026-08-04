import { Prisma } from "@prisma/client";

export type PlayerIdentityKind = "PLAYER_NAME" | "ALIAS";

export type IdentityRecord = {
  ownerId: string;
  ownerName: string;
  value: string;
  kind: PlayerIdentityKind;
};

export type IdentityCandidate = IdentityRecord;

export type PlayerIdentityConflictCode =
  | "PLAYER_NAME_CONFLICT"
  | "PLAYER_NAME_USED_AS_ALIAS"
  | "PLAYER_ALIAS_USED_AS_NAME"
  | "PLAYER_ALIAS_CONFLICT"
  | "PLAYER_ALIAS_EQUALS_NAME";

export class PlayerIdentityConflictError extends Error {
  readonly status = 409;

  constructor(
    readonly code: PlayerIdentityConflictCode,
    readonly value: string,
    message: string
  ) {
    super(message);
    this.name = "PlayerIdentityConflictError";
  }
}

export type IdentityValidationOptions = {
  allowExistingAliasForSameOwner?: boolean;
};

export type PlayerIdentityPayload = {
  ownerId: string;
  name: string;
  aliases?: readonly (string | { alias: string })[];
};

type PlayerIdentityDb = {
  player: {
    findMany(args: {
      select: {
        id: true;
        name: true;
        status: true;
        aliases: { select: { alias: true } };
      };
    }): Promise<
      {
        id: string;
        name: string;
        status: string;
        aliases: { alias: string }[];
      }[]
    >;
  };
};

function conflictFor(candidate: IdentityCandidate, conflicting: IdentityRecord): PlayerIdentityConflictError {
  if (candidate.kind === "PLAYER_NAME") {
    if (conflicting.kind === "PLAYER_NAME") {
      return new PlayerIdentityConflictError(
        "PLAYER_NAME_CONFLICT",
        candidate.value,
        `球员名称“${candidate.value}”已被球员“${conflicting.ownerName}”使用。`
      );
    }

    return new PlayerIdentityConflictError(
      "PLAYER_NAME_USED_AS_ALIAS",
      candidate.value,
      `球员名称“${candidate.value}”已被球员“${conflicting.ownerName}”作为别名使用。`
    );
  }

  if (conflicting.kind === "PLAYER_NAME") {
    return new PlayerIdentityConflictError(
      "PLAYER_ALIAS_USED_AS_NAME",
      candidate.value,
      `球员别名“${candidate.value}”与球员“${conflicting.ownerName}”的名称重复。`
    );
  }

  return new PlayerIdentityConflictError(
    "PLAYER_ALIAS_CONFLICT",
    candidate.value,
    `球员别名“${candidate.value}”已被球员“${conflicting.ownerName}”使用。`
  );
}

export function assertIdentityCandidatesAvailable(
  existing: readonly IdentityRecord[],
  candidates: readonly IdentityCandidate[],
  options: IdentityValidationOptions = {}
) {
  const earlierCandidates: IdentityCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.kind === "ALIAS") {
      const ownName = candidates.find(
        (other) =>
          other.ownerId === candidate.ownerId &&
          other.kind === "PLAYER_NAME" &&
          other.value === candidate.value
      );
      if (ownName) {
        throw new PlayerIdentityConflictError(
          "PLAYER_ALIAS_EQUALS_NAME",
          candidate.value,
          `球员别名不能与球员名称“${candidate.value}”相同。`
        );
      }
    }

    for (const record of existing) {
      if (record.value !== candidate.value) continue;
      if (record.ownerId === candidate.ownerId && record.kind === "PLAYER_NAME") continue;
      if (
        options.allowExistingAliasForSameOwner &&
        record.ownerId === candidate.ownerId &&
        record.kind === "ALIAS" &&
        candidate.kind === "ALIAS"
      ) {
        continue;
      }

      throw conflictFor(candidate, record);
    }

    for (const record of earlierCandidates) {
      if (record.value !== candidate.value) continue;
      throw conflictFor(candidate, record);
    }

    earlierCandidates.push(candidate);
  }
}

function candidateFromPayload(payload: PlayerIdentityPayload): IdentityCandidate[] {
  return [
    {
      ownerId: payload.ownerId,
      ownerName: payload.name,
      value: payload.name,
      kind: "PLAYER_NAME"
    },
    ...(payload.aliases ?? []).map((item) => ({
      ownerId: payload.ownerId,
      ownerName: payload.name,
      value: typeof item === "string" ? item : item.alias,
      kind: "ALIAS" as const
    }))
  ];
}

export async function assertPlayerPayloadsAvailable(
  db: PlayerIdentityDb,
  payloads: readonly PlayerIdentityPayload[],
  options: IdentityValidationOptions = {}
) {
  const players = await db.player.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      aliases: { select: { alias: true } }
    }
  });
  const existing: IdentityRecord[] = players.flatMap((player) => [
    {
      ownerId: player.id,
      ownerName: player.name,
      value: player.name,
      kind: "PLAYER_NAME" as const
    },
    ...player.aliases.map((alias) => ({
      ownerId: player.id,
      ownerName: player.name,
      value: alias.alias,
      kind: "ALIAS" as const
    }))
  ]);
  const candidates = payloads.flatMap(candidateFromPayload);

  assertIdentityCandidatesAvailable(existing, candidates, options);
}

function lateWriteConflict(candidate: IdentityCandidate) {
  if (candidate.kind === "PLAYER_NAME") {
    return new PlayerIdentityConflictError(
      "PLAYER_NAME_CONFLICT",
      candidate.value,
      `球员名称“${candidate.value}”已被其他球员使用。`
    );
  }

  return new PlayerIdentityConflictError(
    "PLAYER_ALIAS_CONFLICT",
    candidate.value,
    `球员别名“${candidate.value}”已被其他球员使用。`
  );
}

export function translatePlayerIdentityWriteError(
  error: unknown,
  candidates: readonly IdentityCandidate[]
): never {
  const isPrismaUniqueError =
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  const isTriggerUniquenessError =
    error instanceof Error && /(?:trigger|unique|duplicate)/i.test(error.message);
  const candidate = candidates[0];

  if ((isPrismaUniqueError || isTriggerUniquenessError) && candidate) {
    throw lateWriteConflict(candidate);
  }

  throw error;
}
