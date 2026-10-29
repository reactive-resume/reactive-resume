# Custom application lanes (#3518): backend and migration review (Claude)

Scope: backend and migration only. The review covered the local working tree on branch `3518-need-custom-or-additional-stages-in-application-kanban-view` against baseline `aeb82c68b6840ef1e6c45e99de40bd960c4f8fb9`. No source files were changed. All database work used disposable database `rr_lanes_3518_codex` on local PostgreSQL. Every SQL reproduction ran inside a transaction that was rolled back.

## Proof run in this review

- `packages/api/src/features/applications/lanes.integration.test.ts`, run with `/tmp/rr-lanes-api-vitest.mts` and `INTEGRATIONS_TEST_DATABASE_URL=…/rr_lanes_3518_codex`: 1 file, 21 tests passed.
- `/tmp/rr-lanes-review/old-linker.sql`: reproduces the baseline guest linker against the migrated schema (finding 1).
- `/tmp/rr-lanes-review/trigger-fix.sql`: applies the proposed trigger change in a rolled-back transaction and reruns the baseline linker statement (finding 1).
- Not rerun here: the full API/auth suites, typechecks, and the migration chain/repeat/snapshot checks. Those results come from the earlier backend worker report.

## Findings, most severe first

### 1. High (reproduced): baseline guest linking fails once the migration is applied

Location: `migrations/20261029063845_nappy_thor/migration.sql`, `application_assign_lane()`.

Baseline `linkAnonymousAccount` (`aeb82c68b:packages/auth/src/config.ts`) runs `UPDATE application SET user_id = <target> … WHERE user_id = <guest>` and leaves `lane_id` unchanged. The migration assigns every guest application a lane owned by the guest (`application-lane:<guest>:<status>`). The trigger therefore does this:

- `lane_id` is not null and is unchanged, and `status` is unchanged, so the trigger skips the reassignment branch.
- The `chosen` lookup uses `id = NEW.lane_id AND user_id = NEW.user_id`. That lane belongs to the guest, not the target, so the lookup finds nothing and `chosen.id IS NULL`.
- The trigger raises `23514 Application lane must be active, owned and compatible…`. Without the trigger, the composite FK `application_lane_owner_fk (user_id, lane_id)` would reject the row anyway.

Reproduction (`old-linker.sql`): both forms of the baseline statement fail, whether or not the target account already has lanes:

```
ERROR:  Application lane must be active, owned and compatible with its category and outcome
CONTEXT:  PL/pgSQL function application_assign_lane() line 23 at RAISE
```

Impact: the whole link transaction rolls back. This happens during a rolling deployment, when an old instance handles a guest's sign-up or sign-in, and after any rollback to the previous image while the expand-only migration stays applied. On every such link, the guest's resumes, cover letters and applications do not transfer. Not verified: whether Better Auth still finishes the sign-in and deletes or strands the guest after `onLinkAccount` throws. Either outcome loses the transfer.

Smallest correct fix: in the trigger, treat an unchanged lane that no longer belongs to the row's owner like a missing lane. Add `chosen.id IS NULL` to the UPDATE reassignment condition:

```sql
IF NEW.lane_id IS NULL OR
  (TG_OP = 'UPDATE' AND NEW.lane_id IS NOT DISTINCT FROM OLD.lane_id AND
   (chosen.id IS NULL OR NEW.status IS DISTINCT FROM OLD.status OR
    (chosen.closed_reason IS NOT NULL AND NEW.closed_reason IS DISTINCT FROM chosen.closed_reason))) THEN
```

`chosen.id IS NULL` can only happen when the stored lane does not belong to `NEW.user_id`, which in practice means the owner changed. The change:

- Keeps the new owner, the canonical `status` and the current `closed_reason`. The default Closed lane has no preset, so a Ghosted application with `no-response` stays valid.
- Leaves `activity` untouched, so lane-label and outcome snapshots stay intact, and so does the no-response evidence used for prior-application warnings.
- Puts the application in the target's default lane for its category. An old server cannot copy custom lanes, so this is the correct way for it to degrade. History events keep the guest's lane IDs; their `laneLabel` snapshots still render.
- Still rejects any explicit foreign lane, because a changed `lane_id` does not reach this branch.
- Does not change the new linker: it writes an explicit target-owned `lane_id`, so it goes through the existing path.

Proof of the fix (`trigger-fix.sql`, rolled back): the baseline `UPDATE application SET user_id=…` moved 3 rows. The rows were a default Applied lane, a custom Interview lane, and a Ghosted lane holding `no-response` plus a history snapshot. They now sit in `application-lane:rv-target:{applied,interview,closed}`. `closed_reason = no-response` and the history `laneLabel = Ghosted` are kept. An explicit foreign `lane_id` on UPDATE and on INSERT still raises 23514.

The migration has not been released, so edit it in place. `snapshot.json` does not track functions and needs no change. Recommended regression test in `lanes.integration.test.ts`, next to "rolling old-server writes…": seed a guest with default, custom and preset lanes, then run the raw baseline statement `getDb().update(tables.application).set({ userId: target }).where(eq(tables.application.userId, guest))`. Assert owner, status, closedReason and activity, and assert that `laneId` is the target's category default. Not run: the existing suite against the edited migration.

### 2. Medium (from code reading, not reproduced): career email now holds the owner lock during SMTP

Location: `packages/api/src/features/career/jobs.ts`, `sendPendingEmail`.

Each notification now runs `sendCareerNotification` inside `db.transaction`. That transaction holds `user FOR NO KEY UPDATE`, which is the same lock `lockUser` takes, plus the application row `FOR UPDATE`. The SMTP transport sets connection, greeting and socket timeouts of 10 seconds each (`packages/email/src/transport.ts:22-24`). A slow or unreachable relay can therefore block every `lockUser` writer for that user for tens of seconds. The blocked writers include application create/update/bulk, lane settings, the Career writers and lane `get`. Each email also holds a pooled connection for that time. Notifications with no application also take the user lock.

The Closed check only needs to be a compare-and-claim, not a lock held across network I/O. Suggested fix: inside a short transaction, lock, check the application is not Closed, and mark the notification claimed. Send the email after the commit. This matches the existing at-least-once behavior. A second option: re-check the application status without locks right before sending.

### 3. Low (from code reading): bulk outcome-only updates now reject mixed selections

Location: `packages/api/src/features/applications/lanes.ts:63`, reached through `bulkUpdate`.

Baseline `bulkUpdate({ ids, closedReason })` with no `status` set the reason on every selected row (`stageFields(undefined, reason)`). The new code resolves each row's transition separately. One non-Closed row in the selection throws `BAD_REQUEST "Only closed applications have a closure outcome."` for the whole batch. The web and mobile bulk menus send lane or status moves, so this is not verified for them. REST, MCP and API-key callers that relied on the old behavior will now fail. The new behavior is arguably more correct. If it is intended, document it in the OpenAPI description or the changelog. Otherwise, skip non-Closed rows for outcome-only bulk updates.

### 4. Low (from code reading): overdue schedules fire right away when an application is reopened

Location: `packages/api/src/features/career/jobs.ts`, the `enqueue` filter.

Closed applications are excluded from `enqueue`, and their schedule's `nextRunAt` is not advanced. When the application is reopened, any schedule whose `nextRunAt` passed while it was Closed qualifies on the next tick. A follow-up or briefing for a stale time then runs immediately. This keeps the user's schedules, as the contract requires. Confirm that running a stale due time once on reopen is the intended product behavior. Not tested.

### 5. Low (not verified): a guest link over the lane cap fails with CONFLICT

Location: `packages/auth/src/config.ts`, `linkAnonymousAccount`.

When the combined active lanes would exceed 40, the link throws `APIError("CONFLICT")` before anything transfers. The test "guest linking rejects over-capacity merges atomically" covers this, and the throw is atomic. However, the conflict surfaces inside the sign-in flow, and the user cannot act on the message until they return to the guest session. This needs about 35 or more combined custom lanes, so it is rare. Consider transferring over-cap guest custom lanes as retired with their applications remapped to category defaults, or confirm that the error is acceptable.

## Areas checked with no defect found

- **Migration backfill.** It is expand-only and seeds deterministic IDs. It leaves `status`, `closed_reason`, `activity`, the submission snapshots and the timestamps untouched. Lazy seeding through the trigger and `ensureApplicationPipeline` is idempotent under `ON CONFLICT DO NOTHING`. The test "supports concurrent lazy seeding" passed here.
- **Old-server writes other than linking.** Legacy echo, status change, outcome change on a preset lane, a new insert with no lane, and account deletion all behave correctly. Account deletion cascades both tables and `application_lane_owner_fk` is checked at end of statement. Verified with SQL (deletion) and with the existing test (writes).
- **Owner validation.** Explicit `laneId` resolves only among the owner's active lanes, on create, import, update, bulk and the Career writers. The trigger and the composite FK enforce the same rule at the database level.
- **Contradictions.** A lane/status mismatch, a lane/outcome mismatch, and an outcome on a non-Closed lane are all rejected.
- **Retirement.** Revision check and `lockUser` serialization. Moving applications preserves `updatedAt` and adds no events or snapshots. System lanes cannot retire. The replacement must be active and have the same category and preset.
- **Retirement race.** Old-server writers never set `lane_id`. New-code writers hold `lockUser`, so an application cannot land in a retired lane.
- **Submission idempotency.** `submitApplication` retry detection ignores lane-only `applied` events (`canonicalTransition !== false`). `recordSentResume` runs only on canonical transitions or document changes, so lane moves and metadata edits do not create snapshots.
- **Lock order.** The new `lockUser` calls in `execute`, `trackOpportunity` and email all take the user lock before the application lock, which matches the existing writers. The interview and timeline paths lock only the application, never the user afterwards. No new lock cycle found.
- **Closed suppression.** Covers `enqueue`, `execute` (before and inside the transaction) and email delivery. Schedules and notification history are not deleted.
- **Export and Career context.** Account export includes `applicationPipeline`. Career prompt and tool context includes `laneId`, `laneLabel` and `closedReason`, with a pipeline-revision CONFLICT guard.
- **New guest linker.** Locks both users in sorted order, maps system lanes to the target's system lanes, copies custom and retired lanes under new IDs, rewrites only mapped history lane IDs, and bumps the target revision.

## Coordinator resolution (after review)

Findings 1 and 2 fixed locally. The unshipped trigger now reconciles owner-only legacy guest transfers to the target's category defaults, preserving all other stored fields. SMTP delivery runs after the existing claim and short owner/application checks have committed. New regressions failed before these fixes for both seeded/unseeded legacy targets and a blocked application close during a held SMTP promise; all 24 lane integration tests then passed.

Finding 3 retains the intentional category/outcome validation. REST/OpenAPI and MCP descriptions now explain that an outcome-only update requires every selected application to be Closed, or an explicit Closed destination; contradictions fail atomically. Finding 4 retains schedules while Closed and resumes overdue work after reopening; the product guide now explains this and the limit that already-sending email cannot be recalled.

Finding 5 received a real authentication-flow reproduction. Although the merge rolled back, Better Auth had already sent the target's new session cookie. A 409 therefore switched the browser away from the guest and stranded its data in the current session. Coordinator now clears the pending credential cookies, restores the existing guest cookie/cache and revokes the new session before propagating the merge error. The browser regression failed before this fix and passed afterward; it also retires the extra guest lane and retries the sign-in successfully, preserving the application. Email/password recovery is verified; native/OAuth callback failure recovery has not been exercised end to end.

Fresh proof after remediation: disposable full migration chain and repeat migration passed; generated snapshot comparison returned `no_changes`. API lane/account integration tests passed (30 tests), full auth suite passed (49), MCP passed (22), API/auth/MCP/server typechecks and server production build passed. The larger affected API rerun passed 130 tests and initially skipped six account tests because its separate OAuth DB variable was absent; those six subsequently ran and passed with that variable supplied. This records coordinator remediation, not an independent reviewer re-review.
