# Player Name Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one normalized namespace across player standard names and aliases in every current player-management write path, returning HTTP 409 with a specific conflict explanation.

**Architecture:** Add a small pure server module that builds and searches a normalized lookup from player names and aliases, using the existing `playerImportKey` normalization. API routes load the relevant player records and reuse this module; the player page catches route errors and shows them without clearing form state.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 5, Zod, Ant Design 5, Vitest 2, pnpm 9.

## Global Constraints

- Standard names and aliases share one namespace.
- Comparison uses `playerImportKey`: full-width normalization, punctuation/list-marker cleanup, whitespace removal, and case-insensitive English comparison.
- Single create, rename, and alias creation conflicts return HTTP 409 with the conflicting standard name or alias owner.
- Bulk import keeps partial-success behavior and reports conflicts in `skipped`.
- Renaming excludes only the current player's standard-name record; that player's aliases remain occupied.
- Do not add a database name-claim table or migration in this change.

---

## File Structure

- Create `lib/server/player-name-occupancy.ts`: pure normalized lookup, conflict search, and Chinese conflict-message formatting.
- Create `tests/player-name-occupancy.test.ts`: behavior tests for standard names, aliases, normalization, exclusion, and messages.
- Modify `app/api/players/route.ts`: protect single-player creation.
- Modify `app/api/players/bulk/route.ts`: use shared lookup for existing names and aliases.
- Modify `app/api/players/parse/route.ts`: use the same shared lookup for recognition status.
- Modify `app/api/players/[id]/route.ts`: protect player renames.
- Modify `app/api/players/[id]/aliases/route.ts`: protect alias creation.
- Modify `app/players/page.tsx`: show API conflict errors while preserving forms.

### Task 1: Shared player-name occupancy module

**Files:**
- Create: `lib/server/player-name-occupancy.ts`
- Create: `tests/player-name-occupancy.test.ts`

**Interfaces:**
- Consumes: `playerImportKey(value: string): string` from `lib/ai/player-list.ts`.
- Produces: `PlayerNameSource`, `PlayerNameConflict`, `buildPlayerNameOccupancy(players, options?)`, `findPlayerNameConflict(name, players, options?)`, and `formatPlayerNameConflict(subject, submittedName, conflict)`.

- [ ] **Step 1: Write failing normalized-conflict tests**

Create fixtures with two real-shaped player records and assert literal outcomes:

```ts
import { describe, expect, it } from "vitest";
import {
  findPlayerNameConflict,
  formatPlayerNameConflict
} from "@/lib/server/player-name-occupancy";

const players = [
  {
    id: "player-a",
    name: "张三",
    aliases: [{ id: "alias-a", alias: "老张" }]
  },
  {
    id: "player-b",
    name: "BOBO",
    aliases: [{ id: "alias-b", alias: "波波" }]
  }
];

describe("player name occupancy", () => {
  it("finds an occupied standard name after normalization", () => {
    expect(findPlayerNameConflict("bobo", players)).toEqual({
      kind: "PLAYER_NAME",
      playerId: "player-b",
      playerName: "BOBO",
      value: "BOBO"
    });
  });

  it("finds an occupied alias after normalization", () => {
    expect(findPlayerNameConflict("老 张", players)).toEqual({
      kind: "ALIAS",
      playerId: "player-a",
      playerName: "张三",
      value: "老张",
      aliasId: "alias-a"
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `corepack pnpm test -- tests/player-name-occupancy.test.ts`

Expected: FAIL because `@/lib/server/player-name-occupancy` does not exist.

- [ ] **Step 3: Add exclusion, availability, and message tests**

Add tests proving that the current standard name can be excluded while its alias remains occupied, an unused name returns `null`, and messages identify the source:

```ts
expect(
  findPlayerNameConflict("张三", players, {
    excludeStandardNameOfPlayerId: "player-a"
  })
).toBeNull();

expect(
  findPlayerNameConflict("老张", players, {
    excludeStandardNameOfPlayerId: "player-a"
  })?.kind
).toBe("ALIAS");

expect(findPlayerNameConflict("李四", players)).toBeNull();

const conflict = findPlayerNameConflict("老张", players)!;
expect(formatPlayerNameConflict("球员名称", "老张", conflict)).toBe(
  "球员名称“老张”已被球员“张三”用作别名“老张”"
);
```

- [ ] **Step 4: Implement the minimal pure module**

Define input records independently of Prisma-generated types so tests and routes can pass selected fields:

```ts
import { playerImportKey } from "@/lib/ai/player-list";

export type PlayerNameSource = {
  id: string;
  name: string;
  aliases: { id?: string; alias: string }[];
};

export type PlayerNameConflict =
  | { kind: "PLAYER_NAME"; playerId: string; playerName: string; value: string }
  | { kind: "ALIAS"; playerId: string; playerName: string; value: string; aliasId?: string };

export type PlayerNameOccupancyOptions = {
  excludeStandardNameOfPlayerId?: string;
};
```

`buildPlayerNameOccupancy` must insert standard names before aliases and keep the first record for a key, `findPlayerNameConflict` must return `lookup.get(playerImportKey(name)) ?? null`, and `formatPlayerNameConflict` must produce the two source-specific Chinese messages.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `corepack pnpm test -- tests/player-name-occupancy.test.ts`

Expected: all occupancy tests PASS.

- [ ] **Step 6: Commit the shared behavior**

```bash
git add lib/server/player-name-occupancy.ts tests/player-name-occupancy.test.ts
git commit -m "Add shared player name occupancy checks"
```

### Task 2: Apply the shared rule to all player APIs

**Files:**
- Modify: `app/api/players/route.ts`
- Modify: `app/api/players/bulk/route.ts`
- Modify: `app/api/players/parse/route.ts`
- Modify: `app/api/players/[id]/route.ts`
- Modify: `app/api/players/[id]/aliases/route.ts`
- Test: `tests/player-name-occupancy.test.ts`
- Create: `tests/player-name-routes.test.ts`

**Interfaces:**
- Consumes: `buildPlayerNameOccupancy`, `findPlayerNameConflict`, and `formatPlayerNameConflict` from Task 1.
- Produces: consistent HTTP 409 responses `{ message: string }`; bulk-import `skipped` entries retain the existing response shape.

- [ ] **Step 1: Add failing route contract tests**

Mock only the Prisma database boundary, invoke the real route handlers, and assert their HTTP contracts. Use a shared fixture in which `player-a` has standard name `张三` and alias `老张`.

```ts
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    player: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    playerAlias: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST as createPlayer } from "@/app/api/players/route";
import { PATCH as renamePlayer } from "@/app/api/players/[id]/route";
import { POST as createAlias } from "@/app/api/players/[id]/aliases/route";
```

Add these real response assertions:

```ts
expect((await createPlayer(createRequest)).status).toBe(409);
expect(await response.json()).toEqual({
  message: "球员名称“老张”已被球员“张三”用作别名“老张”"
});

expect((await renamePlayer(renameRequest, { params: { id: "player-a" } })).status).toBe(409);
expect((await createAlias(aliasRequest, { params: { id: "player-b" } })).status).toBe(409);
```

The rename case must request `老张`, proving that excluding the current standard name does not exclude its aliases. The alias case must request `张三`, proving standard names occupy alias names.

- [ ] **Step 2: Run route tests and verify RED**

Run: `corepack pnpm test -- tests/player-name-routes.test.ts`

Expected: FAIL because the current handlers create/update records without returning the required 409 conflicts.

- [ ] **Step 3: Protect single creation**

Wrap `POST /api/players` in `try/catch`, load `{ id, name, aliases: { id, alias }[] }`, call `findPlayerNameConflict(body.name, players)`, and return:

```ts
if (conflict) {
  return NextResponse.json(
    { message: formatPlayerNameConflict("球员名称", body.name, conflict) },
    { status: 409 }
  );
}
```

Use `apiErrorResponse(error, "新增球员失败")` for non-conflict errors.

- [ ] **Step 4: Protect renames**

In `PATCH /api/players/[id]`, only when `body.name !== undefined`, load all player name sources and call:

```ts
findPlayerNameConflict(body.name, players, {
  excludeStandardNameOfPlayerId: params.id
});
```

Return 409 on conflict, otherwise run the existing update. Wrap the route with `apiErrorResponse(error, "更新球员失败")`.

- [ ] **Step 5: Protect alias creation**

Before `prisma.playerAlias.create`, load all player name sources and call `findPlayerNameConflict(body.alias, players)` without exclusions. Return HTTP 409 using subject `"别名"`. Keep the existing Prisma P2002 fallback for historical or exact same-player races.

- [ ] **Step 6: Reuse the lookup in bulk import and list parsing**

Delete both route-local `buildExistingLookup` functions. Build the shared occupancy map once per request. In bulk import, convert a conflict into a skipped row whose reason is `formatPlayerNameConflict("球员名称", name, conflict)` and whose `existingPlayerId`/`existingName` come from the conflict. In parse, set `exists`, `existingPlayerId`, and `existingName` from the shared lookup.

When processing bulk input, keep `seenInput` so duplicate entries inside the request remain `名单中重复`; add each accepted name key to the request-local set before scheduling creation.

- [ ] **Step 7: Run focused tests and compile**

Run:

```bash
corepack pnpm test -- tests/player-name-occupancy.test.ts tests/player-list.test.ts
corepack pnpm test -- tests/player-name-routes.test.ts
corepack pnpm build
```

Expected: tests PASS and all five API routes compile in the production build.

- [ ] **Step 8: Commit API integration**

```bash
git add app/api/players/route.ts app/api/players/bulk/route.ts app/api/players/parse/route.ts app/api/players/[id]/route.ts app/api/players/[id]/aliases/route.ts tests/player-name-occupancy.test.ts tests/player-name-routes.test.ts
git commit -m "Enforce unique player names across APIs"
```

### Task 3: Preserve forms and show conflict messages in the admin UI

**Files:**
- Modify: `app/players/page.tsx`

**Interfaces:**
- Consumes: rejected `requestJson` promises whose `Error.message` contains the API's 409 message.
- Produces: Ant Design error messages for create, rename, and alias submissions without resetting or closing their forms on failure.

- [ ] **Step 1: Add explicit error handling to single creation**

Wrap the request and success-only cleanup in `try/catch`:

```ts
try {
  await requestJson<Player>("/api/players", request);
  form.resetFields();
  message.success("已新增球员");
  await load();
} catch (error) {
  message.error(error instanceof Error ? error.message : "新增球员失败");
}
```

Keep `form.resetFields()` inside the successful branch.

- [ ] **Step 2: Add explicit error handling to rename and alias creation**

Apply the same pattern to `updatePlayer` and `addAlias`. Only call `setEditing(null)`, clear `aliasInputs[playerId]`, show success, and reload after a successful request. Use fallbacks `"更新球员失败"` and `"保存球员别名失败"`.

- [ ] **Step 3: Run the full verification suite**

Run:

```bash
corepack pnpm test
corepack pnpm build
git diff --check
```

Expected: every Vitest test passes, the Next.js production build succeeds, and `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Review the final diff for scope and secrets**

Run:

```bash
git status --short
git diff -- app/players/page.tsx app/api/players lib/server/player-name-occupancy.ts tests/player-name-occupancy.test.ts
```

Confirm no `.env`, generated directories, unrelated refactors, or database schema changes are present.

- [ ] **Step 5: Commit the UI behavior**

```bash
git add app/players/page.tsx
git commit -m "Show player name conflict messages"
```
