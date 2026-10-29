# Custom application lanes implementation contract

Issue: https://github.com/reactive-resume/reactive-resume/issues/3518. Accepted research: `.agents/docs/research/custom-application-stages-2026-10-29.md`. Implement locally on the existing branch; no commits, pushes, PRs or deployments in this implementation stage.

## Ownership

- Backend worker: schema and DB packages/migrations; API application DTO/service/router; Career application writers and schedules; account export API and auth guest linking. Own backend-focused tests. Do not edit client or MCP files.
- Web worker: `apps/web` application UI/routes, linked document labels, web account ZIP export, client-focused tests and product guide updates/screenshots. Do not edit shared contracts or mobile/backend files. Do not run Lingui extraction while other workers are editing; coordinator owns generated catalogs.
- Mobile worker: `apps/mobile` application/detail/board/workspace/linked-document surfaces and tests. Do not edit shared contracts, web/backend, or generated catalogs.
- Coordinator: MCP, generated OpenAPI/catalogs, integration checks, migration rehearsal, final reviews and fixes. Preserve the research note.

## Contract shared by all workers

Preserve canonical `ApplicationStatus` and `application.status` values: saved, applied, screening, interview, offer, closed. User-facing lanes map to one canonical category. Analytics and submission effects use canonical meaning, never display order.

New shared module `@reactive-resume/schema/applications/lanes` exports:

```ts
type ApplicationLane = {
  id: string;
  category: ApplicationStatus;
  label: string | null; // null: translated category default; custom label: literal user content
  color: string; // validated #RRGGBB
  position: number;
  systemKey: ApplicationStatus | null;
  closedReason: ApplicationClosedReason | null; // preset only for Closed-category lane
  retiredAt: Date | null;
};
type ApplicationPipeline = { revision: number; lanes: ApplicationLane[] };
```

Also export matching Zod `applicationLaneSchema`, `applicationPipelineSchema`, `createDefaultApplicationLanes(): ApplicationLane[]` for safe old-server fallback (synthetic IDs equal canonical category), `getApplicationLane(lanes, application)` resolving a nullable/missing `laneId` to its category default, and `getActiveApplicationLanes(lanes)` in configured order. Backend owns these exports. Inputs remain bounded (label 80 chars, at most 40 active lanes; hex colors); avoid arbitrary CSS input. Default labels retain Lingui localization on clients.

New nested `orpc.applications.lanes` / `client.applications.lanes` procedures (backend implements with REST routes and documented operation IDs):

- `get`: no required input; returns `ApplicationPipeline`, all lanes including retired for history.
- `create`: `{ expectedRevision: number; label: string; category: ApplicationStatus; color: string; closedReason?: ApplicationClosedReason | null }`; returns `ApplicationPipeline`.
- `update`: `{ id: string; expectedRevision: number; label?: string; color?: string }`; returns `ApplicationPipeline`. Category and closure preset immutable after creation. System default labels/colors may be renamed; default mapping remains fixed.
- `reorder`: `{ expectedRevision: number; ids: string[] }` (every active lane exactly once); returns `ApplicationPipeline`.
- `retire`: `{ id: string; replacementId: string; expectedRevision: number }`; returns `ApplicationPipeline`. System defaults cannot retire. Replacement must be active and have the same category and closure preset; preserve app/event identity and snapshot data. Retired history remains resolvable. Replacement selection is explicit in UI.

Read first before mutation. Stale settings revision returns CONFLICT with refreshable UI, with no partial mutation. Serialize against application transitions using established per-user locking. No settings read should update application timestamps or create sent snapshots. New clients detect unsupported lane API on old self-hosted backends and keep fixed-stage behavior; do not send unknown lane-only payloads to old servers. Do not treat every network/auth failure as an old server.

Application additions:

- Optional/nullable `laneId` on full and summary output, optional `laneId` input on create/import/update/bulkUpdate and list filters. Missing fields from older servers remain safe for clients. New server validates ownership/active lane and derives canonical status and preset outcome. Contradictory explicit category/outcome fails. Legacy unchanged-status echoes/metadata edits preserve custom lane; explicit change to another category picks that category's default. Outcome changes incompatible with a preset lane select neutral default Closed for legacy writes.
- Add optional lane ID, lane-label snapshot, closed-reason snapshot, and `canonicalTransition?: boolean` to existing `type: stage` timeline entries. The canonical `stage` stays unchanged. Same-category lane moves append one event with `canonicalTransition: false`; exact no-op moves append nothing. True canonical changes remain canonical transitions. Outcome changes within Closed record durable outcome history too.
- Canonical submission/date/Insights helpers ignore lane-only events for semantic milestones, while current-lane anchor and time-in-lane use lane identity. Legacy events without new fields retain existing semantics. No historical JSON rewrite required for backfill.
- Backend retains current per-application `closedReason`; new historical snapshots permit durable prior-no-response warnings even after reopening. No attempt to reconstruct cleared historical outcomes.
- `orpc.applications.priorNoResponse` input `{ company: string; excludeId?: string }`, output array `{ id: string; company: string; role: string; at: Date }`, bounded to 10, same owner only, conservative case/whitespace company matching. Includes currently no-response applications and recorded historical no-response outcomes. UI presents advisory prior applications at create and mark-as-applied; never blocks submission. No fuzzy company identity service.

## Required behavior

Manage lanes access from Applications on web and native. Add, rename, choose color, reorder via accessible controls, retire custom lanes with explicit compatible replacement. Closing presets permit a Ghosted lane (closed + no-response). Every lane can be targeted by board drag/menu, detail selection and bulk move; creation/import where applicable. Maintain current native long-press gesture/tap behavior, rollback and keyboard/menu alternatives on web. Arbitrary lane count/labels must not break five-column detail layout.

Canonical category still governs Closed visibility, next steps/reminders, source/document linking, sent-version snapshots and existing Insights. Render selected lane label/color throughout. Next-lane navigation uses active configured order, skipping terminal Closed lanes; explicit Close/preset selection retains outcome flow. Preserve current semantic no-reply clock across same-category Applied lane moves. Client same-category pending-move state and summary/detail hydration compare lane IDs as well as status/reason.

CSV: retain canonical Stage, add lane label/category/preset metadata, require explicit lane mapping when importing unknown/cross-account lanes (no foreign ID trust; no silent downgrade to Saved). Preserve formula safety and existing legacy CSV support. Account export includes lane definitions; web ZIP includes metadata; native full-account JSON naturally includes additive response fields.

Every application writer, including Career applyReply/submitApplication/trackOpportunity, must maintain lane/category/history through one transaction-aware owner operation while preserving submission idempotency/snapshots and ownership. Guest linking transfers/remaps lane ownership and references without collisions. Closed applications suppress queued Career follow-up/briefing work and delivery; do not delete user schedules/history merely for closure. API exports, REST/MCP discovery and calls, and AI prompt context must retain canonical categories plus lane labels when useful.

## Verification and stop condition

Add meaningful regression tests at owner seams for migration preservation/backfill, tenant isolation, legacy writes, same-category transitions, timeline date stability, retirement races/settings revisions, snapshots/submission retries, guest transfer, native cancellation, client rollback/hydration, CSV mapping and semantic analytics stability. No production data in fixtures. Run scoped checks while workers edit; coordinator owns full lint/format, boundaries, affected typechecks/tests, production build, disposable DB migration rehearsal, and browser workflow proof. Read relevant skills before Drizzle/migration/test work; Drizzle skills revision check already ran from `@reactive-resume/db` and returned revision 12. Use Context7 CLI for library-specific API/config changes; no need for business logic-only work.

After implementation, independent Claude and Codex reviews must assess runtime correctness and compatibility; coordinator fixes findings. Report local vs CI/device/deployed proof separately. Stop with complete local implementation and reviewable diff, no automatic publication.

## Integration and review evidence

All implementation workers completed and verified the change locally on `3518-need-custom-or-additional-stages-in-application-kanban-view`, based on `aeb82c68b6840ef1e6c45e99de40bd960c4f8fb9`. The subsequent commit/PR delivery is authorized separately; see repository history for its current state. No production migration or deployment was performed during local verification.

Independent Codex web/MCP and Claude mobile reviews are recorded under `.agents/docs/reviews/`. Coordinator fixed their findings:

- Named CSV import waits for stage discovery; retry keeps the CSV. Confirmed older servers retain canonical category and preset outcome without foreign lane IDs.
- Confirmed stage creations persist across import failures. An uncertain create reply requires metadata refresh and explicit reconciliation before another create. Two distinct lanes of one category receive distinct IDs. Browser proof covers a second-create failure, an import failure before commit, and a committed stage with a lost response.
- Explicit ordinary Close, including bulk Close, targets the default Closed lane even when the outcome stays unchanged.
- Reply metrics use recorded rejection outcomes and their dates, including outcome-only changes and reopening. Canonical progression and submission calculations still ignore lane-only events.
- Fast failed board moves clear their pending override and roll back visibly.
- Native prior-application navigation asks before discarding a draft and cannot interrupt saving. Confirmed closes/deletes cancel device reminders after an account switch. Complete bulk receipts to immutable Closed targets cancel without a follow-up read; partial receipts require authoritative results.
- List keeps category priority (Interview, Offer, Screening, Applied, Saved, Closed), then configured lane order within each category, on web and native. Board, detail and next-lane navigation use configured global order.
- A native metadata outage permits safe canonical default writes while retaining the retry notice.
- Legacy owner-only guest transfers now reconcile to the target's category defaults without changing other stored application data. Explicit foreign lane writes remain rejected. New-code transfers retain custom lane definitions and remap references.
- Career email keeps its existing claim/retry behavior but releases owner/application locks before SMTP. Slow delivery cannot block closing or moving applications.
- A failed over-capacity guest merge restores the guest cookie/cache and revokes the target's newly created session. The real auth-flow regression failed before this fix, then passed; retiring the extra guest stage permits a successful retry with the application intact.

### Local checks actually run

- Backend worker: 143 tests in nine files, no skips; schema/DB/API/auth typechecks; scoped lint/format. Full disposable migration chain, repeat application and generated snapshot comparison (`no_changes`) passed. No production data used.
- Coordinator: MCP suite, five files / 22 tests, plus MCP typecheck; web suite, 89 files / 399 tests after review fixes; final CSV suite, 19 tests; native host suite, 22 tests. Web/mobile/server typechecks passed.
- Production server build and web client/marketing prerender build passed. Web used installed Vite+ `createBuilder` with `envDir: false`; root `.env.local` and `.env.production` are FIFOs and were not read. Context7 quota prevented online documentation lookup; installed API/types supplied build-option evidence.
- Initial affected browser gate: 11 tests across custom lanes, submission snapshots, guest linking and Career. Expanded custom-lane browser gate: seven tests passed, followed by successful focused reruns for pending/failed metadata recovery and bulk default-Closed selection with an unchanged outcome.
- Repository lint, format, Turbo boundaries and diff whitespace checks passed. OpenAPI and PDF translations regenerated. Two fictional screenshots were captured from the real UI, inspected and copied into the new product guide.
- Web/mobile Lingui extraction completed after review fixes. It reports 64 missing web messages and 51 missing native messages per non-source catalog; source English is available. Translation completeness is not claimed.
- Android and iOS bundle exports passed again after review fixes.
- Pre-fix negative controls were run for the two-new-lanes CSV defect and native no-reply clock. Independent reviews reproduced their reported defects. Separate pre-fix negative controls were not rerun for every coordinator regression added after those reviews.
- Backend-review fixes received their own negative controls: both legacy guest transfer variants and the slow-SMTP write test failed before remediation, then all 24 lane integration tests passed. Actual over-capacity email/password sign-in switched away from the guest before the recovery fix and retains access afterward.
- Fresh API rerun: 130 tests passed across five files; six account tests initially skipped because `OAUTH_TEST_DATABASE_URL` was absent, then passed when supplied. Final lane/account rerun passed 30 tests. Full auth suite passed 49 tests; schema lane suite passed three; MCP suite passed 22. API/auth/MCP/server typechecks and server production build passed after backend remediation.
- Final disposable database `rr_lanes_3518_review_fixes`: complete migration chain, repeat migration and generated snapshot comparison (`no_changes`) passed. No reset of an existing database or production migration performed.

### Remaining gates and limits

All three independent reviews completed; coordinator remediation and the intentional remaining product constraints are recorded in their reports. Final affected browser rerun passed all 16 tests, including capacity-error recovery and successful retry, old-server fallback, submission snapshots and Career flows. Deployment remains outside this task; deploy the compatible backend before native updates.

Not verified: hosted CI, deployed behavior, physical-device gestures, VoiceOver/TalkBack, OTA against a deployed old server, store delivery, native fingerprint comparison and native/OAuth callback failure recovery. A lost application-import response still requires checking Applications before retrying, as with existing create/import behavior; stage-creation recovery does not make application import idempotent. No claim of full account restore: exports retain lane definitions, but existing import workflows do not restore all account history.
