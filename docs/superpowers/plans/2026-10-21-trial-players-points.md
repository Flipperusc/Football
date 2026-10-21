# Trial players, own goals and points eligibility implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved trial-player, own-goal and matchday points PRD end to end.
**Architecture:** Matchday-scoped TrialPlayer identities are distinct from Player. GoalEvent references either a formal or trial participant for each role. TeamAssignment.pointsEligible controls all matchday points; event identity and eligibility are covered by confirmation validation. UI partitions share the existing event source.
**Tech Stack:** Next.js 14, React 18, Ant Design 5, Prisma 5, PostgreSQL, Vitest, Playwright.
**Spec:** tasks/prd-trial-players-own-goals-points-eligibility.md

## Global constraints
- Do not create fake formal players for trials. Trial panel shows only name and goal/assist/own-goal sections.
- Formal participant statistics survive mixed trial/formal events; trial participants have no formal appearances or points.
- All matchday points, including awards and bonuses, become zero when pointsEligible=false; attendance remains unchanged.
- Own goals have no assist and never enter normal goal or assist totals.
- Work on codex/trial-players-points-eligibility in the existing checkout so the user's local preview uses the implementation; user explicitly requested direct execution. No push or production deployment.

## Shared interfaces
- TrialPlayer: { id: string; name: string; confirmed: boolean; matchDayId: string }; request representation omits matchDayId. ids are client-generated UUID strings, validated as matchday-scoped server-side.
- MatchDay.trialPlayers: TrialPlayer[]. Create/update payload accepts trialPlayers. Server returns them with matchday details. Confirm payload optionally accepts trialPlayers for edits and binds them into its proof.
- MatchedPlayer adds trialPlayerId?: string | null. Exactly one of playerId/trialPlayerId is permitted for resolved event participants.
- TeamAssignment adds pointsEligible: boolean @default(true); request/client fields may be optional for historical compatibility. Confirm token includes this state.
- GoalEvent.scorerId becomes nullable; adds scorerTrialPlayerId and assistTrialPlayerId with TrialPlayer relations named scorerTrialPlayer / assistTrialPlayer. GoalEvent retains ordinary Player relations and optional trial relations.
- PlayerSeasonStats and client PlayerStats add internalOwnGoals: number. Statistical event scorerId becomes string|null.
- inspectInternalEvents(parsed, assignments, trialPlayers?) validates resolved trial membership and confirmation; roster snapshots may be null. Event exceptions allow scorerTeam undefined for trial participants.

## Review focus
1. Unknown names cannot silently become confirmed trial identities; low-confidence matches remain reviewable.
2. Mixed formal assist / trial scorer events count the formal assist, without requiring a formal scorer.
3. Forged trial IDs from another matchday and changed eligibility invalidate confirmation.
4. Award points cannot bypass pointsEligible=false; restore produces recomputed, not accumulated, totals.
5. Reparse, conversion and failed reconfirm preserve old formal data and do not duplicate event attribution.

### Task 1: Backend identity and persistence
**Files:** prisma/schema.prisma, additive migration, lib/validations.ts, lib/ai/*, lib/match-events.ts, lib/server/confirm-matchday.ts, lib/server/event-confirmation.ts, app/api/matchdays/**.
**Interfaces:** Produce shared schema and trial-aware confirmation/parse contracts above; consume pointsEligible allocation from Task 2.
- [x] Write failing tests for trial validation, mixed events, cross-matchday identity, pending trial and confirmation changes; run Vitest and inspect expected failures.
- [x] Implement additive schema, scoped trial CRUD, AI trial resolution, authoritative identity validation and transactional confirmation. Preserve manual identities and qualification across parse.
- [x] Run focused backend tests; expected PASS.

### Task 2: Statistics and read-only views
**Files:** lib/stats/*, lib/server/stats.ts, lib/client-types.ts, app/players/[id]/page.tsx, app/matchdays/[id]/share/page.tsx, app/api/public/matchdays/[id]/route.ts, dependent player-detail APIs as needed.
**Interfaces:** Consume nullable scorer and trial relations from Task 1; produce internalOwnGoals and trial-aware public event names; pointsEligible=false yields base/bonus/total 0.
- [x] Write failing tests proving base 3 + bonus 2 => 0, restore=>5, attendance unchanged, trial scorer/formal assist attribution and own-goal totals separate.
- [x] Implement pure calculation, projections, personal own goals and separated share/export own-goal section.
- [x] Run focused stats tests; expected PASS.

### Task 3: Entry and confirmation UI
**Files:** components/MatchEntryForm.tsx, app/matchdays/[id]/confirm/page.tsx, components/MatchEventConfirmationModal.tsx, new trial identity/summary helpers, tests.
**Interfaces:** Consume trialPlayers and pointsEligible requests; select trial events using trialPlayerId with null playerId; preserve stable event indexes across partitions.
- [x] Write failing helper tests for trial summaries, unmatched roster import, participant replacement and own-goal conversion.
- [x] Implement pending trial roster handling, manual trial entry/correction, event selection, separate own-goal tables, confirmation summary and cancel/restore points controls.
- [x] Run focused tests; expected PASS. Browser verification owned by Task 4.

### Task 4: Integration, browser verification and documentation
**Files:** e2e/*, README.md, AGENTS.md, this plan/progress.
- [x] Generate Prisma client and run TypeScript check, resolve shared interface errors.
- [x] Add E2E for roster unknown -> trial confirmation -> mixed events -> own goals -> exclude/restore -> re-open plus rejected stale/cross-matchday proof and rollback. Run isolated database migrations and tests.
- [x] Run full Vitest, production build and E2E; expected PASS. Check desktop and mobile display.
- [x] Perform fresh independent review, repair material findings with regression tests.
- [x] Update docs, apply local migrations and restart local development server; verify HTTP/data API. Report completed work and any material limits.

## Progress
- Baseline: 146 tests / 26 files pass. New branch based on a6a1eaa.
- PRD approved by user's direct instruction to implement; no additional design-approval round required.
- Full unit regression: 177 tests / 31 files pass (2026-10-21). Worker count limited to one for local memory availability.
- Independent review repaired stale name corrections overriding newer manual identities and stale roster mappings surviving removal; regression coverage added for both.
- Confirmed-match edits use draft rosters and trial identities, preserving official events/statistics until the confirmation transaction succeeds.
- Production build passes, including TypeScript validation and all 25 static pages (2026-10-21).

- Final browser verification: all 8 Playwright scenarios pass against the production build (54.6s); desktop and 390px mobile screenshots reviewed. Trial/points main flow includes formal own-goal detail, exclusion/restoration, draft reparse isolation and identity correction.
- Browser regression revealed and repaired stale season requests overwriting current player details, and populated bonus/award tables overflowing mobile width.
- Local PostgreSQL football_team migration 20261021000000_trial_players_points applied; local development service restarted at port 3000. No remote push or production deployment.

## Approved UI simplification and eligibility retirement (2026-10-21)
- Removed the normal-goal event-type column; conversion remains available as a row action.
- Removed matchday points eligibility UI and calculation behavior; legacy request flags normalize to true. Added migration restoring excluded points from the latest manual confirmation, with a real PostgreSQL rollback verification (passed).
- Combined awards and bonus points into 特殊积分与奖项, removing attached-points and point-status columns. Moved aliases above trial players.
- Verification: 177 unit tests, 8 browser scenarios and 1 migration integration scenario pass; production build passes; desktop layout inspected.


## Automatic trial identities (2026-10-21)
- Unmatched scorer/assistant names now become matchday-scoped pending trials, including existing confirmation-page parses. Trial labels are recognized during roster and AI parsing. Explicit local event clauses retain unfamiliar names, while named formal guest players remain formal.
- New trial identities persist as drafts until confirmation. Existing manual corrections take precedence.
- Verification: 181 unit tests, 10 end-to-end scenarios and production build passed. Local preview restarted.

