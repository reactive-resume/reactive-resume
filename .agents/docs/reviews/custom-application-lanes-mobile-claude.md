# Custom application lanes (#3518): native mobile review (Claude)

Scope: changed and untracked `apps/mobile` source/scripts plus `packages/schema/src/applications/{data,lanes}.ts`, against baseline `aeb82c68b`. Backend correctness out of scope. Re-ran `pnpm --filter mobile test` (node --test, 22/22 pass). No device, store or deployed proof.

## Findings

### 1. Medium: prior-application link in Save a job discards the draft without confirmation

`apps/mobile/src/features/applications/add-sheet.tsx:420` passes the sheet's own `onClose` as `PriorNoResponse`'s `onOpen`. The callback runs before `router.push` (`prior-no-response.tsx:57`). `onClose` unmounts `AddApplicationSheet` (`views.tsx` `adding &&`, list screen likewise) and bypasses the `EditorSheet` `dirty` guard. The warning only renders after a company name is typed, so the form is always dirty when the link is visible.

Scenario: the user pastes a posting, reviews the parsed fields and picks resume/letter/tags. The "previous application closed with No response" notice appears, and the user taps the earlier application to check it. All entered and parsed data is lost. If the user taps it during `busy === "save"`, the sheet unmounts mid-save. The job may still be created, but the user is never navigated to it.

Fix: route this through the same `ConfirmDialog` discard pattern as `openSearchSettings` (`add-sheet.tsx:233,543`). Alternatively, open the prior application without closing the draft. Disable the link while `busy`.

### 2. Medium: list section order changes on lane-capable servers (regression and web parity)

`list.ts:52` groups by `visibleLanes(lanes, …)`, which sorts by pipeline `position`. `list-screen.tsx:94` passes real lanes whenever `lanes.supported`. After a server upgrade, every user's list therefore reorders to Saved, Applied, Screening, Interview, Offer, Closed. This happens even with no custom lanes. Before, the order was `LIST_ORDER` ("what needs you first": Interview, Offer, Screening, Applied, Saved, Closed). On old servers, the default-argument path still uses `LIST_ORDER`, so one app behaves differently by server version. Web keeps `LIST_ORDER` by category and then lane position within each category (`apps/web/src/features/applications/components/list-view.tsx:96`).

Fix: order groups by `LIST_ORDER.indexOf(lane.category)` first and lane position second. Keep the retired/unknown lanes that `visibleLanes` appends. Proof: a `groupApplications` assertion with supported default lanes expecting Interview before Saved.

### 3. Low: reminder cancellation is gated on the current account, but reminders are device-global

`queries.ts:187-231`: `update.onSuccess`, `remove.onSuccess`, `bulkDelete.onSuccess` and `bulkUpdate.onSuccess` skip `cancelReminders` when `scope !== getAccountScope()`. Reminders in `features/reminders/index.ts` are keyed by application UUID and are never cleared on sign-out or account switch. A late success for account A's delete or close is still a fact, and cancelling that application's notification cannot affect account B. The gate only leaves a stale reminder that fires for a deleted or closed application. The baseline cancelled unconditionally. The `bulkUpdate` gate is legitimate only for the authoritative re-read, because that call needs the old scope.

The bulk lost-read path (`queries.ts:220-225`) also cancels nothing. Rows the server owns all receive the requested category (`service.ts` bulkUpdate). For `status: "closed"`, or a `laneId` whose cached lane category is `closed`, input-derived cancellation would be exact. The test at `applications-summary.test.mjs:665` deliberately forbids this, so it is a design choice. Note it: the toast's recovery depends on the user opening each application.

Fix: drop the scope gate on cancellation for update, delete and bulkDelete, where the IDs are explicit. Optionally fall back to input-derived cancellation when the bulk re-read fails.

### 4. Low: a lanes outage blocks every write, including canonical default-lane writes

`ready = query.isSuccess` (`lane-queries.ts:36`) gates create (`add-sheet.tsx:176`), bulk actions, board moves, the stepper, Close and Mark applied. A transient `lanes.get` failure therefore prevents saving a job into the default Saved lane. A canonical `{ status }` write is safe on both server generations, so `laneInput(lane, false)` would work. `LaneNotice` offers retry, so this is a degraded state rather than data loss. Consider allowing system-lane writes as canonical `status` while metadata is errored.

## Checked, no finding

- Old-server detection: oRPC 1.16 maps the bare 404 body to code `NOT_FOUND` (`getMalformedResponseErrorCode`). The fallback keeps synthetic category IDs. `laneInput` sends canonical status. `ensureLaneWrite` refuses `laneId` writes to unsupported servers. `priorNoResponse` is gated on `supported`. The mobile check is looser than web's (any `NOT_FOUND` or `METHOD_NOT_SUPPORTED` counts), but a misdetection only downgrades the client to safe canonical writes.
- Scoped metadata: lanes and prior-no-response keys include server and scope. The list and detail key omits scope but is cleared on identity change (`session-gate.tsx`). Calls carry `context.scope`, so a stale closure fails with `SessionChangedError` instead of writing to another account.
- Writers: detail stepper and next button, board drag and Move sheet, list bulk move and close, add sheet, Close and Mark applied sheets all route through `laneInput`. A neutral Closed lane opens the outcome sheet. A preset (Ghosted) lane writes directly, with the optimistic `closedReason` taken from the preset. Saved to an Applied-category lane always goes through Mark applied with the chosen lane.
- `nextActiveLane` follows the active configured order, skips Closed lanes, and returns null for closed or unresolved lanes.
- Optimistic and pending state: same-category moves compare `laneId` (`keepPending`, `getInitialApplicationDetail`). Rollback restores the list snapshot and is scope-guarded.
- History: the time in a lane comes from `currentLaneEntry`, which keeps the retired anchor. The no-reply clock for Applied uses only canonical entries. `sentOn` and Insights ignore lane-only events. Timeline labels use the `laneLabel` snapshot, and a null snapshot uses the localized default.
- Lane settings: revision passed on every write, a CONFLICT error message plus refetch, retirement offers only compatible replacements, and a system label is sent only when it changed (localized defaults are preserved). Long labels wrap (`flexShrink`/`flex: 1`), and reorder uses labelled up/down buttons.

## Residual verification gaps

- No device run: board long-press drag across many or long-labelled columns, Move sheet, lane settings sheet at 0.9 detent, and VoiceOver/TalkBack for the new controls are unverified.
- Host tests stub oRPC and TanStack callbacks. They do not cover how TanStack v5 swaps in-flight mutation callbacks on re-render after an account switch, or a real old-server 404 through `RPCLink`.
- Non-source mobile catalogs: translation completeness unverified.

## Coordinator resolution (after review)

All four findings corrected locally. Prior-application navigation asks before discarding a draft and is disabled during save. List retains category priority on lane-capable servers. Confirmed single close/delete and bulk delete cancel their device-global reminders after an account switch; complete bulk receipts with immutable Closed targets also cancel directly. A no-data metadata error permits canonical default writes while retaining the retry notice.

Coordinator reran all 22 mobile host tests successfully, with new draft-confirmation/save-lock, default-lane List order, recorded-outcome, metadata-outage and reminder-cancellation regressions. Mobile typecheck passed. Device/accessibility and translation limits above remain. This records coordinator remediation, not an independent reviewer re-review.

- An OTA client against a deployed old self-hosted server is untested end to end.
