# Player Name and Alias Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow administrators to delete player aliases, enforce a team-wide unique namespace across player names and aliases with friendly `409` responses, and document the project architecture and zero-to-running workflow.

**Architecture:** Keep `Player` and `PlayerAlias` as separate Prisma models. Centralize identity conflict detection in one server module, use API preflight checks for clear messages, and use PostgreSQL unique indexes plus advisory-locking cross-table triggers as the final concurrency-safe guard. Add a narrow nested DELETE route for aliases and keep the UI change within the existing player management table.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5.7, Ant Design 5, Prisma 5, PostgreSQL, Zod, Vitest, pnpm 9.

## Global Constraints

- Active and inactive players both reserve their names and aliases.
- Compare trimmed values exactly and case-sensitively; do not add fuzzy, pinyin, case-folding, or Unicode normalization.
- A player's alias may not equal that player's own standard name.
- Do not silently merge, rename, or delete existing conflicting data.
- Return `409 Conflict` with a stable `message`, `code`, and `value` for expected name conflicts.
- Do not expose real `.env` values or secrets in code, tests, logs, or documentation.
- Preserve unrelated working-tree content, including the existing untracked `.worktrees/` directory.

---

## File Structure

- Create `lib/server/player-identities.ts`: identity record types, conflict error, pure collision detection, Prisma-backed availability checks, and conversion of late Prisma uniqueness failures.
- Create `tests/player-identities.test.ts`: all exact-name, alias, inactive-player, batch, and late-constraint behavior tests.
- Modify `lib/server/api-error.ts`: serialize the domain conflict error as HTTP 409.
- Modify player create, update, bulk, alias-create, and match-confirm write paths to call the shared identity guard.
- Modify `prisma/schema.prisma`: table-level uniqueness declarations.
- Create `prisma/migrations/20260804000000_player_identity_uniqueness/migration.sql`: preflight checks, indexes, advisory-locking trigger functions, and triggers.
- Create `tests/player-identity-migration.test.ts`: repository-level assertions for the schema and SQL integrity guard.
- Create `app/api/players/[id]/aliases/[aliasId]/route.ts`: ownership-safe alias deletion.
- Create `tests/player-alias-delete.test.ts`: deletion service behavior.
- Create `tests/client-types.test.ts`: 204 handling in the shared fetch helper.
- Modify `lib/client-types.ts`: return `undefined` for successful 204 responses.
- Modify `app/players/page.tsx`: closable alias tags, confirmation, loading state, and success message.
- Create `docs/项目架构与启动指南.md`: complete architecture and startup guide.
- Modify `README.md`: link to the new guide and list the DELETE alias API.

---

### Task 1: Identity Conflict Domain Module

**Files:**
- Create: `tests/player-identities.test.ts`
- Create: `lib/server/player-identities.ts`

**Interfaces:**
- Produces: `IdentityRecord = { ownerId: string; ownerName: string; value: string; kind: "PLAYER_NAME" | "ALIAS" }`.
- Produces: `IdentityCandidate = { ownerId: string; ownerName: string; value: string; kind: "PLAYER_NAME" | "ALIAS" }`.
- Produces: `PlayerIdentityConflictError` with `status = 409`, `code`, `value`, and a Chinese `message`.
- Produces: `assertIdentityCandidatesAvailable(existing, candidates, options?)` for pure validation.
- Produces: `assertPlayerPayloadsAvailable(db, payloads, options?)` for Prisma-backed route and transaction use.
- Produces: `translatePlayerIdentityWriteError(error, candidates)` for converting a late database uniqueness error to the domain error.

- [ ] **Step 1: Write the failing pure conflict tests**

Create `tests/player-identities.test.ts` with focused cases using records shaped like:

```ts
const existing = [
  { ownerId: "active", ownerName: "张三", value: "张三", kind: "PLAYER_NAME" as const },
  { ownerId: "inactive", ownerName: "李四", value: "老李", kind: "ALIAS" as const }
];

expect(() =>
  assertIdentityCandidatesAvailable(existing, [
    { ownerId: "new:0", ownerName: "张三", value: "张三", kind: "PLAYER_NAME" }
  ])
).toThrowError(PlayerIdentityConflictError);
```

Add separate tests for: an inactive player's name, name versus another player's alias, alias versus another player's name, alias versus another player's alias, an alias equal to its own candidate name, a repeated name inside one batch, a repeated alias inside one batch, and a non-conflicting payload.

- [ ] **Step 2: Run the identity test and verify RED**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Expected: FAIL because `@/lib/server/player-identities` does not exist.

- [ ] **Step 3: Implement the minimal pure domain logic**

Implement exact-string comparison after caller-side Zod trimming. Use these error codes:

```ts
type PlayerIdentityConflictCode =
  | "PLAYER_NAME_CONFLICT"
  | "PLAYER_NAME_USED_AS_ALIAS"
  | "PLAYER_ALIAS_USED_AS_NAME"
  | "PLAYER_ALIAS_CONFLICT"
  | "PLAYER_ALIAS_EQUALS_NAME";
```

The validator must compare each candidate against existing records and all earlier candidates. It must exclude only the current player's old `PLAYER_NAME` record during a rename, while retaining that player's aliases as reserved values. Support `allowExistingAliasForSameOwner: true` only for the match-confirm path so an already-saved alias is an idempotent no-op there.

- [ ] **Step 4: Run the identity tests and verify GREEN**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Expected: PASS for all pure collision cases.

- [ ] **Step 5: Add failing tests for Prisma-backed loading and late errors**

Use a small fake object implementing `player.findMany`. Assert that `assertPlayerPayloadsAvailable` turns included players and aliases into identity records, retains inactive players, and validates an entire batch. Construct a `Prisma.PrismaClientKnownRequestError` with code `P2002` and assert `translatePlayerIdentityWriteError` throws a `PlayerIdentityConflictError` containing the attempted value.

- [ ] **Step 6: Run the new tests and verify RED**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Expected: FAIL because the database adapter and late-error conversion are not implemented.

- [ ] **Step 7: Implement the Prisma-backed adapter and translator**

Query only `id`, `name`, `status`, and `aliases { alias }`. Convert every player name and alias to `IdentityRecord`, then call the pure validator. For late `P2002` or trigger-origin uniqueness errors, choose the contextual candidate's code/message instead of exposing the Prisma message.

- [ ] **Step 8: Run the task tests and type-check**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Run: `corepack pnpm exec tsc --noEmit`

Expected: both commands succeed.

- [ ] **Step 9: Commit the domain module**

```bash
git add lib/server/player-identities.ts tests/player-identities.test.ts
git commit -m "feat: add player identity conflict validation"
```

---

### Task 2: HTTP 409 Serialization and All Write-Path Integration

**Files:**
- Modify: `lib/server/api-error.ts`
- Modify: `app/api/players/route.ts`
- Modify: `app/api/players/[id]/route.ts`
- Modify: `app/api/players/[id]/aliases/route.ts`
- Modify: `app/api/players/bulk/route.ts`
- Modify: `app/api/matchdays/[id]/confirm/route.ts`
- Modify: `lib/server/confirm-matchday.ts`
- Test: `tests/player-identities.test.ts`

**Interfaces:**
- Consumes: Task 1's `assertPlayerPayloadsAvailable`, `PlayerIdentityConflictError`, and `translatePlayerIdentityWriteError`.
- Produces: all expected identity conflicts as `{ message, code, value }` with HTTP status 409.
- Produces: transaction-safe preflight validation before `confirmMatchDay` deletes or rebuilds any formal match data.

- [ ] **Step 1: Write the failing HTTP response test**

Add a test that passes this error to `apiErrorResponse`:

```ts
const response = apiErrorResponse(
  new PlayerIdentityConflictError("PLAYER_NAME_CONFLICT", "张三", "球员“张三”已存在")
);
expect(response.status).toBe(409);
await expect(response.json()).resolves.toEqual({
  message: "球员“张三”已存在",
  code: "PLAYER_NAME_CONFLICT",
  value: "张三"
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Expected: FAIL because `apiErrorResponse` currently maps the error to status 500.

- [ ] **Step 3: Add 409 serialization**

Check `PlayerIdentityConflictError` before generic Prisma error handling in `apiErrorResponse`, returning its stable fields and status.

- [ ] **Step 4: Run the response test and verify GREEN**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Expected: PASS.

- [ ] **Step 5: Integrate single create, rename, and alias create**

Wrap each route in `try/catch` and use `apiErrorResponse`. Before writing:

```ts
await assertPlayerPayloadsAvailable(prisma, [
  { ownerId: "new:0", name: body.name, aliases: body.aliases?.map((item) => item.alias) ?? [] }
]);
```

For PATCH, use `ownerId: params.id` and validate only when `body.name` is present. For alias POST, validate `{ ownerId: params.id, alias: body.alias }`. Catch late uniqueness errors with `translatePlayerIdentityWriteError` before passing the resulting domain error to `apiErrorResponse`.

- [ ] **Step 6: Integrate batch import**

Keep the existing response shape `{ created, skipped }`. Build all normalized rows first, validate their names and initial aliases as one candidate collection, and classify predictable collisions into `skipped` entries without creating partial invalid identities. Preserve the existing successful-row transaction and convert any late database uniqueness failure to 409.

- [ ] **Step 7: Integrate match-confirm alias saving before destructive work**

Inside the existing Prisma transaction, immediately after loading the match day and before any `deleteMany`, call the shared validator for `input.saveAliases`. Use `allowExistingAliasForSameOwner: true` so confirming again with an already-owned alias remains idempotent. A collision owned by another player must throw `PlayerIdentityConflictError`; the confirm route must return it through `apiErrorResponse` as 409 while retaining 422 for non-identity confirmation validation failures.

- [ ] **Step 8: Run focused and full tests**

Run: `corepack pnpm vitest run tests/player-identities.test.ts`

Run: `corepack pnpm test`

Expected: all tests pass.

- [ ] **Step 9: Commit the write-path integration**

```bash
git add lib/server/api-error.ts app/api/players/route.ts app/api/players/[id]/route.ts app/api/players/[id]/aliases/route.ts app/api/players/bulk/route.ts app/api/matchdays/[id]/confirm/route.ts lib/server/confirm-matchday.ts tests/player-identities.test.ts
git commit -m "feat: reject conflicting player names and aliases"
```

---

### Task 3: Database Uniqueness and Cross-Table Concurrency Guard

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260804000000_player_identity_uniqueness/migration.sql`
- Create: `tests/player-identity-migration.test.ts`

**Interfaces:**
- Consumes: the exact, case-sensitive trimmed values stored by existing APIs.
- Produces: `Player_name_key` and `PlayerAlias_alias_key` unique indexes.
- Produces: `check_player_name_identity_conflict()` and `check_player_alias_identity_conflict()` PostgreSQL trigger functions.

- [ ] **Step 1: Write the failing database-contract test**

Create `tests/player-identity-migration.test.ts`. Read `prisma/schema.prisma` and the planned migration path with `node:fs`. Assert that the Player model contains `name String @unique`, the PlayerAlias model contains `alias String @unique`, and the migration contains all of these stable fragments:

```ts
expect(sql).toContain("pg_advisory_xact_lock");
expect(sql).toContain('CREATE TRIGGER "Player_name_identity_conflict"');
expect(sql).toContain('CREATE TRIGGER "PlayerAlias_alias_identity_conflict"');
expect(sql).toContain('ERRCODE = \'23505\'');
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `corepack pnpm vitest run tests/player-identity-migration.test.ts`

Expected: FAIL because the schema declarations and migration do not exist yet.

- [ ] **Step 3: Update Prisma uniqueness declarations**

Change the models to:

```prisma
model Player {
  name String @unique
  // existing fields and relations remain unchanged
}

model PlayerAlias {
  alias String @unique
  // existing fields remain unchanged
  // remove @@unique([playerId, alias])
}
```

- [ ] **Step 4: Create the migration with explicit conflict preflight**

The migration must use a `DO $$ ... $$` block that raises an exception if any of these queries returns a row:

```sql
SELECT "name" FROM "Player" GROUP BY "name" HAVING COUNT(*) > 1;
SELECT "alias" FROM "PlayerAlias" GROUP BY "alias" HAVING COUNT(*) > 1;
SELECT p."name"
FROM "Player" p
JOIN "PlayerAlias" a ON a."alias" = p."name";
```

The error must instruct the operator to resolve duplicate/conflicting identities before rerunning the migration. Do not mutate user data.

- [ ] **Step 5: Replace the alias index and add player-name uniqueness**

Use explicit SQL:

```sql
DROP INDEX "PlayerAlias_playerId_alias_key";
CREATE UNIQUE INDEX "Player_name_key" ON "Player"("name");
CREATE UNIQUE INDEX "PlayerAlias_alias_key" ON "PlayerAlias"("alias");
```

- [ ] **Step 6: Add advisory-locking cross-table triggers**

Each BEFORE INSERT OR UPDATE trigger calls:

```sql
PERFORM pg_advisory_xact_lock(hashtextextended(NEW."name", 0));
```

or the equivalent for `NEW."alias"`, then checks the other table. Raise SQLSTATE `23505` with a stable constraint name when a collision exists. The alias trigger must reject a value equal to any player's standard name, including its own player's name.

- [ ] **Step 7: Run the contract test and verify GREEN**

Run: `corepack pnpm vitest run tests/player-identity-migration.test.ts`

Expected: PASS, proving the checked-in schema and SQL contain the required guards.

- [ ] **Step 8: Validate and generate Prisma Client**

Run: `corepack pnpm exec prisma validate`

Run: `corepack pnpm run prisma:generate`

Expected: schema validation and client generation succeed.

- [ ] **Step 9: Verify migration when a disposable PostgreSQL database is available**

Run against a disposable database only:

```powershell
$env:DATABASE_URL="postgresql://postgres:<password>@localhost:5432/football_team_identity_test?schema=public"
corepack pnpm prisma migrate deploy
```

Expected: clean migrations succeed; inserting a cross-table collision fails with SQLSTATE 23505. If no disposable PostgreSQL database is available, record that limitation and rely on schema validation plus SQL review without reading or printing the real `.env` value.

- [ ] **Step 10: Commit the database guard**

```bash
git add prisma/schema.prisma prisma/migrations/20260804000000_player_identity_uniqueness/migration.sql tests/player-identity-migration.test.ts
git commit -m "feat: enforce database player identity uniqueness"
```

---

### Task 4: Ownership-Safe Alias Deletion API

**Files:**
- Create: `tests/player-alias-delete.test.ts`
- Add to: `lib/server/player-identities.ts`
- Create: `app/api/players/[id]/aliases/[aliasId]/route.ts`

**Interfaces:**
- Produces: `deletePlayerAlias(db, playerId, aliasId): Promise<boolean>`.
- Produces: `DELETE /api/players/:playerId/aliases/:aliasId`, returning 204 on deletion and 404 when no owned alias matches.

- [ ] **Step 1: Write failing deletion service tests**

Use a fake `playerAlias.deleteMany` returning `{ count: 1 }` or `{ count: 0 }`. Assert the helper always calls:

```ts
{ where: { id: aliasId, playerId } }
```

Add separate tests for successful deletion, another player's path (`false`), and a missing alias (`false`).

- [ ] **Step 2: Run the deletion tests and verify RED**

Run: `corepack pnpm vitest run tests/player-alias-delete.test.ts`

Expected: FAIL because `deletePlayerAlias` does not exist.

- [ ] **Step 3: Implement the minimal deletion helper**

Call `deleteMany` with both identifiers and return `result.count === 1`. Do not query and then delete in separate operations.

- [ ] **Step 4: Run the deletion tests and verify GREEN**

Run: `corepack pnpm vitest run tests/player-alias-delete.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the nested DELETE route**

Implement:

```ts
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; aliasId: string } }
) {
  try {
    const deleted = await deletePlayerAlias(prisma, params.id, params.aliasId);
    if (!deleted) {
      return NextResponse.json({ message: "别名不存在" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error, "删除别名失败");
  }
}
```

- [ ] **Step 6: Run focused tests and type-check**

Run: `corepack pnpm vitest run tests/player-alias-delete.test.ts`

Run: `corepack pnpm exec tsc --noEmit`

Expected: both succeed.

- [ ] **Step 7: Commit the deletion API**

```bash
git add lib/server/player-identities.ts tests/player-alias-delete.test.ts app/api/players/[id]/aliases/[aliasId]/route.ts
git commit -m "feat: add ownership-safe alias deletion API"
```

---

### Task 5: Alias Deletion UI and 204 Client Support

**Files:**
- Create: `tests/client-types.test.ts`
- Modify: `lib/client-types.ts`
- Modify: `app/players/page.tsx`

**Interfaces:**
- Consumes: Task 4's DELETE endpoint.
- Produces: `requestJson<void>` support for HTTP 204.
- Produces: closable alias tags with confirmation and per-alias deletion loading state.

- [ ] **Step 1: Write the failing 204 client test**

Stub `globalThis.fetch` to return `new Response(null, { status: 204 })`, then assert:

```ts
await expect(
  requestJson<void>("/api/players/p1/aliases/a1", { method: "DELETE" })
).resolves.toBeUndefined();
```

- [ ] **Step 2: Run the client test and verify RED**

Run: `corepack pnpm vitest run tests/client-types.test.ts`

Expected: FAIL because `requestJson` currently calls `response.json()` on an empty body.

- [ ] **Step 3: Add minimal 204 handling**

After the existing non-OK branch, add:

```ts
if (response.status === 204) return undefined as T;
```

Keep all existing JSON and error-message behavior unchanged.

- [ ] **Step 4: Run the client test and verify GREEN**

Run: `corepack pnpm vitest run tests/client-types.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the player-page deletion interaction**

Import `Popconfirm` and `X` from the existing UI/icon libraries. Add `deletingAliasId` state and:

```ts
async function deleteAlias(playerId: string, aliasId: string) {
  setDeletingAliasId(aliasId);
  try {
    await requestJson<void>(`/api/players/${playerId}/aliases/${aliasId}`, { method: "DELETE" });
    message.success("已删除别名");
    await load();
  } finally {
    setDeletingAliasId(null);
  }
}
```

Render each tag inside `Popconfirm` with title `确认删除别名“${alias.alias}”？`. Prevent Ant Design's closable Tag from disappearing before confirmation; only the successful `load()` refresh changes the displayed aliases. Disable or load the matching delete control while its request is active.

- [ ] **Step 6: Type-check and build the UI**

Run: `corepack pnpm exec tsc --noEmit`

Run: `corepack pnpm build`

Expected: type-check and production compilation succeed.

- [ ] **Step 7: Commit the UI change**

```bash
git add tests/client-types.test.ts lib/client-types.ts app/players/page.tsx
git commit -m "feat: let administrators delete player aliases"
```

---

### Task 6: Architecture and Zero-to-Running Documentation

**Files:**
- Create: `docs/项目架构与启动指南.md`
- Modify: `README.md`

**Interfaces:**
- Produces: one canonical Chinese architecture and startup guide.
- Produces: README links to the guide and the new DELETE alias API entry.

- [ ] **Step 1: Write the architecture sections**

Document the responsibilities and boundaries of:

```text
Browser UI -> Next.js pages/components -> App Router API -> lib/server services
           -> AI parser or deterministic stats -> Prisma -> PostgreSQL
```

Include the actual key paths from `AGENTS.md`, the player/season/match entity relationships, admin Cookie/middleware flow, upload storage behavior, match parse-confirm transaction, and event-based ranking recalculation.

- [ ] **Step 2: Write Windows setup from a blank machine**

Include exact prerequisites and commands for Git, Node.js 20/22 LTS, Corepack pnpm 9.12.3, PostgreSQL, cloning, copying `.env.example`, creating `football_team`, `prisma:generate`, `prisma migrate deploy`, `pnpm dev`, tests, and production build. Use placeholder credentials only.

- [ ] **Step 3: Write Ubuntu/nginx production setup**

Cover dependency installation, environment file placement, persistent `UPLOAD_DIR`, migrations, build/start, a systemd or process-manager example, nginx reverse proxy headers, HTTP-to-HTTPS redirect, certificate requirement, and Secure admin Cookie behavior.

- [ ] **Step 4: Add troubleshooting and maintenance commands**

Include database connection failures, missing database/tables, Corepack EPERM, absent DeepSeek key fallback, upload permissions, Secure Cookie login loops, migration conflict resolution, `pnpm test`, and `pnpm build`.

- [ ] **Step 5: Update README**

Add a prominent link to `docs/项目架构与启动指南.md`, list `DELETE /api/players/:id/aliases/:aliasId`, and keep the concise quick-start section consistent with the canonical guide.

- [ ] **Step 6: Check documentation for secrets and stale commands**

Run:

```powershell
rg -n "sk-[A-Za-z0-9]|postgresql://[^<\s]+:[^<\s]+@" README.md 'docs/项目架构与启动指南.md'
rg -n "pnpm approve-builds|prisma migrate deploy|ADMIN_SESSION_TOKEN|UPLOAD_DIR" README.md 'docs/项目架构与启动指南.md'
```

Expected: no real secret patterns; required commands and variable names are present; `pnpm approve-builds` appears only if explicitly described as a command not to run.

- [ ] **Step 7: Commit the documentation**

```bash
git add README.md 'docs/项目架构与启动指南.md'
git commit -m "docs: add architecture and startup guide"
```

---

### Task 7: Final Verification

**Files:**
- Verify all files changed in Tasks 1-6.

**Interfaces:**
- Consumes: all preceding deliverables.
- Produces: evidence that tests, types, Prisma schema, formatting checks, and production build pass.

- [ ] **Step 1: Inspect the final diff and working tree**

Run: `git status --short`

Run: `git diff --check 1b1a939..HEAD`

Expected: only intended project files and the pre-existing untracked `.worktrees/` appear; no whitespace errors.

- [ ] **Step 2: Run the complete automated test suite**

Run: `corepack pnpm test`

Expected: all Vitest suites pass with no unexpected warnings.

- [ ] **Step 3: Validate Prisma and TypeScript**

Run: `corepack pnpm exec prisma validate`

Run: `corepack pnpm run prisma:generate`

Run: `corepack pnpm exec tsc --noEmit`

Expected: all commands succeed.

- [ ] **Step 4: Run the production build**

Run: `corepack pnpm build`

Expected: Next.js production build completes successfully.

- [ ] **Step 5: Review security and data integrity manually**

Confirm the DELETE route requires both `playerId` and `aliasId`; middleware still protects `/api/players/**`; no `.env` value is present in the diff; match-confirm validates aliases before deleting formal match data; and migrations never auto-modify conflicting identities.

- [ ] **Step 6: Record any environment-limited verification**

If a disposable PostgreSQL instance is unavailable, report migration execution as not run and distinguish it from the successful Prisma schema/SQL checks. Do not substitute the project's real database unless the user explicitly authorizes it.
