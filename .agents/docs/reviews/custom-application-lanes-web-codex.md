# Custom application lanes: web and MCP review

Reviewed working-tree changes, including untracked feature files, against `aeb82c68b6840ef1e6c45e99de40bd960c4f8fb9` on `3518-need-custom-or-additional-stages-in-application-kanban-view`, 2026-10-29. Read implementation contract and accepted research; traced connected query/cache, transition, export and MCP owners. Backend/mobile remain outside final review scope. No runtime edits, commits, pushes or publication.

## Findings

1. **P2 — Pending/failed lane discovery permits lossy legacy imports.** `apps/web/src/features/applications/use-application-lanes.ts:32`, `apps/web/src/features/applications/components/import-applications-sheet.tsx:97`, `:140`, `:403`.

   Without cached data, both loading and an ordinary network failure return `mode: "legacy"` even with `unsupported: false`. The importer then has no lane mappings, considers all named stages matched, and enables import. `applyLaneMapping` removes the lane metadata. A Ghosted CSV row becomes `{ status: "closed" }`, losing both its selected lane and no-response preset on a server that supports lanes. Isolated execution of the current hook/mapping confirmed this for pending and network-error states. The page alert does not prevent the import sheet from doing this.

   **Fix:** distinguish unresolved/error discovery from confirmed unsupported servers; prevent named-lane import until metadata loads or unsupported capability is established. Keep fixed-stage fallback for confirmed old servers. **Missing proof:** delay/reject only `lanes.get` while import remains reachable; verify import cannot discard metadata, then verify genuine old-server fallback still works.

2. **P2 — Import retry recreates already committed stages.** `apps/web/src/features/applications/components/import-applications-sheet.tsx:120`, `:137`, `:153`.

   Created IDs survive only in the mutation-local map; the corresponding `laneChoices` entries stay `"new"`. If a later create or the application import fails, retry creates the successful stages again using the refreshed revision. This consumes the 40-stage allowance and leaves duplicate stages even when no application imported. Executing the actual mutation body with a mocked failed import, then retrying, produced two `Assessment` stages and assigned the application to the second.

   **Fix:** persist each confirmed new stage as that CSV stage's selected ID and resume from confirmed mappings. After an uncertain create response, refresh and require reconciliation before creating again. **Missing proof:** failure on the second create, failure before application import commits, and a committed create whose response is lost; retry must reuse successful stages.

3. **P2 — Explicit default-Closed actions do not select the default lane.** `apps/web/src/features/applications/use-application-actions.ts:114`, `apps/web/src/features/applications/components/list-view.tsx:452`.

   `ClosedLaneItems` defines its ordinary outcome choices as targeting the default Closed lane, but these paths send only `status: "closed"`. The new server deliberately preserves a custom lane for unchanged-status legacy writes. From Ghosted, choosing the ordinary No response outcome therefore leaves the application in Ghosted despite the requested default destination. Bulk closing compatible custom Closed lanes has the same problem. Executing the connected resolver with this payload returned `laneId: "ghosted", changed: false`.

   **Fix:** use `laneMoveInput(getCategoryLane(lanes, "closed"), mode, reason)` for explicit default-Closed actions, including bulk; retain status-only payloads in confirmed legacy mode. **Missing proof:** menu/bulk moves from custom neutral and preset Closed lanes into the default Closed lane with an unchanged outcome, plus old-server payload compatibility.

4. **P2 — Reply metrics ignore recorded closure outcomes and their dates.** `apps/web/src/features/applications/insights.ts:95`, `:123`.

   The updated event projection discards outcome snapshots and excludes every `canonicalTransition: false` event, including durable outcome changes within Closed. `firstReply` still applies the application's current reason to earlier Closed events. For Applied Jan 1 → No response Jan 5 → Not selected Jan 10, actual `computeOutcomes` returned four days to reply instead of nine. Reopening then changed heard-back count from one to zero despite the recorded rejection. This is a gap in consuming the newly introduced outcome history; legacy events never had these snapshots.

   **Fix:** retain canonical-only events for progression/submission calculations, but derive rejection replies from recorded event outcomes/dates, including outcome-only changes. Use existing current-reason fallback only for legacy events lacking snapshots. **Missing proof:** no-response followed by rejection within Closed, rejection followed by reopening, and same-category lane moves leaving semantic dates unchanged.

5. **P3 — List-order guide contradicts the implemented grouping.** `docs/guides/tracking-job-applications.mdx:48`; connected implementation `apps/web/src/features/applications/components/list-view.tsx:96`.

   The changed guide promises configured stage order. List still orders categories by `LIST_ORDER` and applies configured order only within a category. Moving Applied before Interview changes Board/detail order but leaves List unchanged. **Fix:** describe the actual category-priority grouping and custom order within categories; if global List ordering is intended by the accepted contract, instead build groups directly from ordered active lanes. **Missing proof:** inspect List after reordering lanes across categories and align the documented contract with that result.

## Proof and remaining limits

- Independently passed web checks: four focused files / 32 tests (`csv-export`, `queries`, `next-step`, `use-application-actions`).
- Independently passed MCP checks: two files / seven tests (`parity`, `discovery`). SDK live/static schema and annotation parity and invalid-color rejection passed; no MCP finding.
- Isolated, in-memory reproductions used actual current function/mutation bodies, fake records and mocked clients; no live services or production data.
- Another worker corrected the initially observed two-new-lanes/same-category CSV mapping defect during this review. Current code includes that correction and a third Playwright spec; it is excluded from outstanding findings.
- Existing coordinator build, migration and browser evidence was supplied, not rerun here. The new third CSV Playwright spec was inspected but not executed by this review.
- **Not verified:** fast-failure board override rollback, overlapping optimistic moves, retirement during an open edit/drag, stale settings conflict recovery in a rendered browser, committed application-import response loss/retry safety, keyboard/screen-reader behavior with many long labels, and mobile behavior. No broad checks, device checks, hosted CI or deployment checks were run.
- Global web `MutationCache.onSettled` invalidates ordinary queries. Missing local detail/advisory invalidation alone is therefore not an outstanding finding.

## Coordinator resolution (after review)

All five findings corrected locally. Named imports wait for discovery and retain input through failure/retry. Confirmed created stages persist; uncertain responses require refresh and explicit matching. Ordinary single/bulk Close targets the default Closed lane. Reply metrics consume recorded outcome dates/history. List-order documentation describes category priority plus lane order within category. Fast board-error override cleanup was also added.

Coordinator proof: full web suite (89 files / 399 tests), focused CSV suite (19 tests), web/mobile typechecks and production web build passed. Seven expanded custom-lane browser cases passed, covering distinct same-category CSV stages, partial creation, import failure before commit, committed creation with lost reply, failed drag rollback, retirement, Ghosted history and old-server fallback. A further focused browser run passed with pending then failed discovery and successful recovery. This records coordinator remediation, not an independent reviewer re-review.
