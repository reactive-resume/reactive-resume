# Independent Android review

Reviewed pin: `1430732e5ab4280da6d0a4cc4f87abbaaac85eb3`, 2026-11-08. No product code changed. Auth, career, public and settings observations describe this pin; they **may be addressed by C-R2**.

## Summary

| Area                                                               | Blocker |  Major | Minor |   Nit |  Total |
| ------------------------------------------------------------------ | ------: | -----: | ----: | ----: | -----: |
| Shared privacy, timezone, build, accessibility, motion and haptics |       0 |      6 |     1 |     0 |      7 |
| Today and Documents                                                |       0 |      3 |     1 |     0 |      4 |
| Builder and Assistant                                              |       0 |      5 |     2 |     0 |      7 |
| Letters                                                            |       0 |      2 |     0 |     0 |      2 |
| Applications and Workspace                                         |       0 |      3 |     1 |     0 |      4 |
| Career                                                             |       0 |      2 |     0 |     0 |      2 |
| Public and Settings                                                |       0 |      1 |     2 |     0 |      3 |
| System surfaces                                                    |       0 |      0 |     1 |     0 |      1 |
| **Total**                                                          |   **0** | **22** | **8** | **0** | **30** |

Each numbered finding counts once. Shared defects affect several screens. Major includes broken core flows, lost wording, privacy approval gaps, inaccessible operations and a failed required gate. No blocker was established.

### Evidence and limits

- Read HANDOFF §3/§6, SCREENS notes, PLAN and Android agent rules. Compared all **61 screen IDs in both themes** with the 122 references, including layout, spacing, hierarchy, typography, colour and copy. Inspected all **55 additional feature state captures** and all **11 feature font200 captures**. There are 194 committed PNGs: 122 baselines, 55 extra states, 11 feature font200 and six harness captures (three font200).
- Handoff root: `/Users/amruth/Projects/reactive-resume/.agents/handoff/android-app/`. SCREENS/boards references below resolve there. Source paths are repository-relative. Capture shorthand `module/Filename.png` means `apps/android/feature/module/src/test/screenshots/Filename.png`; corresponding references are under handoff `screens/`.
- `./gradlew testDebugUnitTest`: **passed**, 498 tests, 55 suites, zero failures/errors/skips. Regenerated all 14 feature storyboard-diff reports at `feature/<module>/build/reports/storyboard-diff/index.html`.
- `./gradlew assembleDebug verifyRoborazziDebug`: **passed**; Gradle reused cached/up-to-date work where applicable. Golden verification proves agreement with committed goldens, not storyboard or behavioural acceptance.
- `./gradlew lintDebug`: **failed**, RestrictedApi at `RrApp.kt:166` (R03). Full/release-variant lint was not run.
- Source traces support functional findings below. Reproduction steps are suggested acceptance checks, **not claims of device reproductions**. No emulator, physical device, production API, live AI request or real account data used. TalkBack focus, actual IME/insets, physical haptic feel, platform notifications and launcher rendering remain device gates.

## Shared findings

### R01 — Major — AI requests are not bound to the disclosed recipient

**Screens/captures:** B4 `builder/B4-Improve-light.png`, B16 `assistant/B16-Assistant-light.png`, D4 `documents/D4-Import-light.png`, L1 `letters/L1-Letter-light.png`, W1–W5 (`workspace/W1-Fit-first-run-light.png`, `W3-Prep-light.png`, `W4-Practice-idle-light.png`, `W5-Debrief-light.png`, `W5-Messages-light.png`); dark counterparts too.

**Where/wrong:** `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/FitTab.kt:106`, `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/PrepareTab.kt:105`, `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/PractiseTab.kt:202`, `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/DebriefTab.kt:140`, `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/MessagesTab.kt:132`, `apps/android/feature/assistant/src/main/kotlin/me/rxresu/feature/assistant/AssistantViewModel.kt:96`, `apps/android/feature/letters/src/main/kotlin/me/rxresu/feature/letters/LetterViewModel.kt:123`, `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/BuilderViewModel.kt:531` and `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/ImportViewModel.kt:146` send without `x-ai-destination`. `apps/android/core/network/src/main/kotlin/me/rxresu/core/network/ApiClient.kt:139` forwards explicit headers without synthesizing approval. Builder's provider mapping drops `recipientVersion` at `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/BuilderViewModel.kt:558`. A provider ID alone does not detect a changed base URL on the same connection; default-resolving operations can also use a changed default after disclosure.

**Expected:** HANDOFF §3 says disclose what is sent and where before sending. `packages/api/src/features/ai/destination.ts:8` permits absent approval for old clients; `:33` rejects a changed recipient only when approval exists. Missing headers bypass this protection; they do **not** themselves cause a 409. Existing native career pattern `apps/android/feature/career/src/main/kotlin/me/rxresu/feature/career/CoachModel.kt:41`/`:106` already retains and rechecks the approved recipient.

**Fix/verify:** Extend that shared approval flow to HTTP/SSE/multipart and voice operations, preserving recipient version and operation identity. Display provider A; pause send; change its recipient configuration/default from another client; resume. Assert rejection **before dispatch**, renewed disclosure and retained wording. Use a recording transport, not a real provider call.

### R02 — Major — Account timezone does not drive dates or API headers

**Screens/captures:** J3 `applications/J3-Calendar-light.png`, J8 `J8-Interview-light.png`, S3 `settings/S3-Preferences-light.png`, C7 `career/C7-Schedule-light.png`, T1/X1; both themes. Settings/career aspects **may be addressed by C-R2**.

**Where/wrong:** `apps/android/app/src/main/kotlin/me/rxresu/AppGraph.kt:22` explicitly leaves device timezone in use. `apps/android/core/data/src/main/kotlin/me/rxresu/core/data/RealRepositories.kt:25` defaults `TimeSource()` and passes its timezone to transport at `:31`; `apps/android/core/data/src/main/kotlin/me/rxresu/core/data/Repositories.kt:111` defaults to `ZoneId.systemDefault()`. Saving an account timezone in S3 does not update this owner. Display, scheduling and `x-client-timezone` can disagree with the selected preference.

**Expected/fix/verify:** SCREENS J3/J8/S3 require Settings timezone. Supply one account-aware timezone source to repositories and formatting. With device Berlin/account Lisbon, inspect interview display, newly entered schedule and outgoing header; change S3 without restarting. Repeat DST and account switch.

### R03 — Major — Required lint gate fails on restricted navigation API

**Screen:** P2 → A2 → D4 continuation; static capture cannot show a build failure.

**Where/evidence:** `apps/android/app/src/main/kotlin/me/rxresu/RrApp.kt:166`, `nav.currentBackStack.value`. Executed `lintDebug` fails RestrictedApi: `NavController.getCurrentBackStack` can only be called from the same library group. HANDOFF §6 requires lint passing.

**Fix/verify:** Own pending import through supported saved/navigation state rather than an internal stack scan. Rerun lint and signed-out PDF → sign-in → import, including process restoration. Do not merely suppress RestrictedApi.

### R10 — Major — Feature animations bypass reduced-motion policy

**Screens/captures:** B3 `builder/B3-Outline-light.png`, B8 `B8-Layout-light.png`, B9 `B9-Issues-light.png`, D1 `documents/D1-Library-light.png`, J6/W1–W5; dark too. Static captures do not prove motion.

**Where/wrong:** `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/Reorder.kt:117` uses default `animateFloatAsState` for neighbour movement; `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/CheckMode.kt:161`/`:297` use bare `animateContentSize`; `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/LibraryScreen.kt:225` animates item placement; `apps/android/feature/applications/src/main/kotlin/me/rxresu/feature/applications/ApplicationScreen.kt:279` always animates Overview shortcuts to another pager tab (the strip at `:266` correctly branches). `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/DesignMode.kt:639` unconditionally rotates a lifted chip.

**Expected/fix/verify:** HANDOFF §3/Motion board remove movement when reduced, keeping d1 fades on overlays. Use shared specs/flag and instant placement/scroll/no lifted rotation. Test in-app Reduced with system animator scale still **1**, then system Remove animations. Assert immediate positions/heights/pager settlement; retain shared overlay fade and spinning progress.

System-preference precedence also needs correction: `apps/android/app/src/main/kotlin/me/rxresu/RrApp.kt:85` uses `prefs.reducedMotion ?: systemReduced`, so explicit Full (`false`) overrides system Remove animations. Under the handoff's accessibility rule, system reduction must still win. Select Full, enable system Remove animations, then verify navigation and feature movement stays removed. Settings aspect **may be addressed by C-R2**.

### R11 — Major — 200% view selector clips and list text becomes unreadable

**Screens/capture:** J1–J4; directly visible in `applications/J1-List-light-font200.png`: Insights is clipped at the right; Lumen role wraps into very narrow fragments beside its wide timestamp.

**Where/wrong:** `apps/android/feature/applications/src/main/kotlin/me/rxresu/feature/applications/ApplicationsScreen.kt:241`; `apps/android/core/designsystem/src/main/kotlin/me/rxresu/core/designsystem/RrSegmentedControl.kt:130`/`:160` keeps every segment's intrinsic width even when their sum exceeds available width; track clips at `:92`. `apps/android/feature/applications/src/main/kotlin/me/rxresu/feature/applications/ListView.kt:155`/`:183` and `apps/android/core/designsystem/src/main/kotlin/me/rxresu/core/designsystem/RrList.kt:204` place wide trailing metadata beside weighted text.

**Expected/fix/verify:** HANDOFF §3 requires usable 200% text and wrapping lists. Use adaptive/scrollable oversized segments and stack metadata at large scale. At 390×844 dp/200%, reach all four views by touch/keyboard/TalkBack and read company/role/time without character-sized columns. Repeat RTL and long translations.

### R12 — Minor — Both component and caller emit selection haptics

**Screens/captures:** B1–B3/B6–B8 (`builder/B1-Page-light.png`, `B6-Template-light.png`, `B8-Layout-light.png`), both themes.

**Where/wrong:** `apps/android/core/designsystem/src/main/kotlin/me/rxresu/core/designsystem/RrSegmentedControl.kt:113` emits Selection, then callers emit again at `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/BuilderScreen.kt:108`, `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/WriteMode.kt:98`, `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/DesignMode.kt:453`/`:467`/`:473`/`:539`/`:546`. Caller feedback can also fire on an unchanged selection.

**Expected/fix/verify:** Motion board requires one per gesture. Keep feedback in the shared interactive owner. Inject a haptic counter: changed selection emits one, repeated selected-item tap zero, Haptics off zero. Physical feel still needs hardware.

### R27 — Major — Small dark danger-fill labels fail AA contrast

**Screens/captures:** J1/D1 revealed destructive swipe actions; baseline `applications/J1-List-dark.png` does not show the revealed state.

**Where/wrong:** `apps/android/core/designsystem/src/main/kotlin/me/rxresu/core/designsystem/Tokens.kt:98` defines dark danger `#D9544B`; `:118` defines white `onDanger`; `apps/android/core/designsystem/src/main/kotlin/me/rxresu/core/designsystem/RrSwipeRow.kt:103` uses the pair for small text. Computed WCAG sRGB ratio **3.95:1**, below 4.5:1. This pair is inherited from the reference, but HANDOFF §3 also requires AA.

**Fix/verify:** Resolve the shared danger/foreground token pair with the owner; no feature-local colours. Add contrast assertion and revealed-action captures in both themes. Reference fidelity alone cannot close this accessibility defect.

## Today and Documents

### R04 — Major — Late import response can replace the newly selected file's data

**Screen/capture:** D4 `documents/D4-Import-light.png`/dark.

**Where/wrong:** `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/ImportViewModel.kt:103` resets file/data without canceling old `work`. `read()` captures a file at `:135`, then overwrites shared `data`/current summary at `:150` without a generation check. `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/DocumentsGraph.kt:380` starts a new file. Method switching already cancels at `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/ImportViewModel.kt:125`. A late A completion can show B's filename with A's summary; Create at `:168` imports A.

**Expected/fix/verify:** SCREENS D4 reviews the selected file. Cancel superseded jobs and guard all result/error writes by selection generation. Barrier test: A starts, B selected, B finishes, A finishes, Create. Assert filename/summary/import all B. Repeat late A error and JSON B; cancellation alone must not permit an uncooperative completion.

### R05 — Major — File readers allocate unbounded content before validation

**Screens/captures:** D4 `D4-Import-light.png`; B5 `builder/B5-Basics-crop-light.png`, dark too.

**Where/wrong:** `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/DocumentsGraph.kt:431` calls `readBytes()` without a size bound despite querying metadata; `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/BuilderGraph.kt:92` reads the full photo before sampled decoding/cropping. A large/unknown-length SAF URI can exhaust heap and kill the app with unsaved work. Later image sampling does not bound encoded bytes. Compare bounded reader `apps/android/feature/public/src/main/kotlin/me/rxresu/feature/publiclink/PublicModels.kt:177` and shared-intent copy `apps/android/feature/system/src/main/kotlin/me/rxresu/feature/system/SystemIntents.kt:78`.

**Expected/fix/verify:** Safe import requires a counted stream limit at the trust boundary, not trusting SIZE metadata. Preserve supported crop handling for photos above final upload size. Test oversized and missing/lying-SIZE streams with a small injected limit; assert bounded allocation, useful error and preserved drafts. Do not deliberately OOM a real device.

### R06 — Major — Copy-for-job draft disappears on dismissal

**Screen/capture:** D3 `documents/D3-New-light.png`/dark; baseline shows first step, not its dirty form.

**Where/wrong:** `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/NewDocumentSheet.kt:71` has no `confirmDiscard`; `apps/android/feature/documents/src/main/kotlin/me/rxresu/feature/documents/CopyForJob.kt:43`/`:68` keep company/role/posting/name only locally. Back/swipe down can close the sheet and lose entered work.

**Expected/fix/verify:** HANDOFF §2 requires dirty-sheet confirmation; SCREENS D3 keeps fields after copy failure. Hoist dirty/recovery state to the sheet owner and cover step-back too. Enter a long posting; try Back, scrim, swipe and main-step return; verify Keep editing/Discard, plus failed copy → retry.

### R07 — Minor — Mark as read has no visible swipe alternative

**Screen/capture:** T1 `today/T1-Today-light.png`, dark/offline too.

**Where/wrong:** `apps/android/feature/today/src/main/kotlin/me/rxresu/feature/today/TodayScreen.kt:318` supplies only the swipe action; no matching visible row menu/button/long-press. Shared swipe semantics **do** provide a TalkBack custom action, so this is not a claim that TalkBack lacks it.

**Expected/fix/verify:** HANDOFF §3/Motion board require a menu alternative. Add Mark as read through a visible action with the same Undo. Complete it without swiping and without TalkBack, then check both paths invoke one operation.

## Builder and Assistant

### R08 — Major — Selected block target uses wrong, static sheet coverage

**Screen/capture:** B2 `builder/B2-Entry-light.png`/dark and `B2-Entry-light-font200.png`.

**Where/wrong:** `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/WriteMode.kt:114` passes `1f - EntryDetents.first()` as coverage; `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/PageCanvas.kt:141` subtracts it again. `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/EntrySheet.kt:81` specifies 55%/92% detents, but actual sheet top/IME bounds never reach the calculation. At 55%, target bottom is around 55% of window while sheet begins at 45%; raising the sheet does not update the constant. Picked blocks can remain covered.

**Expected/fix/verify:** SCREENS B2 requires block bottom 16 dp above the current sheet in the same frame. Share measured sheet/available-canvas bounds. Pick low-page blocks at both detents, open keyboard and step Next/Previous; assert visible block and 16 dp clearance at 100%/200% and RTL.

### R09 — Major — Canceled layout drag commits hovered move

**Screen/capture:** B8 `builder/B8-Layout-light.png`/dark.

**Where/wrong:** `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/DesignMode.kt:647` calls `onDrop()` on cancellation; `:602` resolves hover and `:606` calls `placeSection`. Pointer cancellation over Sidebar mutates document layout despite no completed drop.

**Expected/fix/verify:** Cancellation must abort. Separate cancel cleanup from commit. Drag across a zone, dispatch pointer cancellation and assert placement/history unchanged and visuals cleared. Normal release at that position must move exactly once with the prescribed drop haptic.

### R13 — Major — Photo crop positioning has no accessible non-drag operation

**Screen/capture:** B5 `builder/B5-Basics-crop-light.png`/dark.

**Where/wrong:** `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/PhotoCrop.kt:172` exposes pan only through `detectTransformGestures`; `:203` has a zoom slider, not pan controls/actions. TalkBack, keyboard and switch users cannot centre an off-centre subject. Decorative plus/minus icons do not solve positioning.

**Expected/fix/verify:** HANDOFF §3 requires alternatives to every drag. Expose directional position/reset controls or semantic actions backed by the same clamped crop state. Crop an off-centre face with keyboard/TalkBack only, at 100%/200%; verify exported pixel rectangle matches chosen position.

### R14 — Major — Closing proposals loses edited wording

**Screen/capture:** B17 `assistant/B17-Proposals-light.png`/dark and font200; edit-wording state itself lacks a capture.

**Where/wrong:** `apps/android/feature/assistant/src/main/kotlin/me/rxresu/feature/assistant/AssistantScreen.kt:99` keeps wording/baseline in local `remember`; `:105` has no `confirmDiscard`; `:125` edits that text and `:131` promises to retain it on save failure. Closing then reopening loses unsaved wording, including after failed save.

**Expected/fix/verify:** HANDOFF §2 dirty-form protection and §3 keep-person's-words rule. Recover wording by proposal identity and protect dismissal. Edit → forced save failure → Back/swipe/close → reopen; verify recovery. Successful save clears dirtiness; refreshed proposal must not silently overwrite a draft.

### R21 — Major — Inline connection setup returns to stale Assistant provider state

**Screens/captures:** B16 → S6 → B16, `assistant/B16-Assistant-light.png`, `settings/S6-Provider-light.png`; settings aspect **may be addressed by C-R2**.

**Where/wrong:** `apps/android/feature/assistant/src/main/kotlin/me/rxresu/feature/assistant/AssistantViewModel.kt:32` loads providers only in `init`. `apps/android/feature/assistant/src/main/kotlin/me/rxresu/feature/assistant/AssistantGraph.kt:23` retains that model on its owner; `:48` navigates to setup and `:58` reads the retained list. No setup-result/resume refresh exists here. Adding the first connection can return to an empty provider picker/unusable send state; reopening a Builder-owned Assistant need not recreate it.

**Expected/fix/verify:** SCREENS S6 returns to the originating AI surface ready to use the connection. Observe shared provider state or consume setup result without losing draft/thread. Start with zero providers, set up/test/save from B16, return and send without recreating Builder. Repeat adding a second provider.

### R29 — Minor — Documents-to-Builder uses ordinary push instead of thumbnail-to-page transition

**Screens/captures:** D1 → B1, `documents/D1-Library-light.png` and `builder/B1-Page-light.png`, dark too. Static captures do not show the missing transition.

**Where/wrong:** `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/BuilderGraph.kt:56` registers a plain `screen<Builder>`; `apps/android/core/navigation/src/main/kotlin/me/rxresu/core/navigation/Shell.kt:100` inherits ordinary push. The NavHost at `apps/android/app/src/main/kotlin/me/rxresu/RrApp.kt:116` has no shared thumbnail/page transition owner. Reduced push at `Shell.kt:62` is None, rather than B1's specified crossfade. Source scan found no shared-element/bounds wiring.

**Expected/fix/verify:** SCREENS B1 requires thumbnail scaling into the page over d3 and a reduced crossfade. Add shared geometry/identity at the navigation owner, without animating PDF reflow. Record open/back from several grid positions, light/dark and reduced; verify correct thumbnail identity, stable page bounds and no movement under reduction.

### R30 — Minor — Outline drag cannot move a section across pages or into Sidebar

**Screen/capture:** B3 `builder/B3-Outline-light.png`/dark.

**Where/wrong:** `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/WriteMode.kt:153` creates a separate ReorderColumn per page/column; `:169` supplies only that group's refs and `:177` updates only that page/column. `apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/Reorder.kt:78` reports only indices in its local items. Dragging cannot change parent group. Move-to menus exist, so the operation remains available and this is not an accessibility-alternative failure.

**Expected/fix/verify:** SCREENS B3 explicitly supports dragging across pages/Sidebar. Coordinate drag identity/drop zones across groups through the layout owner while retaining the menus. Use a two-page/two-column resume, drag one section to each other group, reload/export and inspect placement. Cancellation must not commit; repeat RTL and reduced motion.

## Letters

### R15 — Major — Normal rich cover letters cannot be edited

**Screen/capture:** L1 `letters/L1-Letter-light.png`/dark; baseline details sheet does not exercise body editing.

**Where/wrong:** `apps/android/feature/letters/src/main/kotlin/me/rxresu/feature/letters/LettersGraph.kt:97` identifies any HTML tag as rich; `:98` disables Save, `:100` shows read-only stripped text and `:101` says editing is unavailable. `apps/android/feature/letters/src/main/kotlin/me/rxresu/feature/letters/LetterViewModel.kt:146` converts kept AI drafts to HTML, so that primary creation path also produces an uneditable body.

**Expected/fix/verify:** SCREENS L1 requires a full-screen rich editor/toolbar; this is not a PLAN exception. Reuse the existing rich-text/persistence owner rather than stripping formatting. Edit a formatted web letter's words/list/emphasis, save/reload/export; also Keep an AI draft then edit it. Preserve unrelated markup and wording on failed save.

### R16 — Major — Letter preview stops at page one and cannot zoom

**Screen/capture:** L1 `letters/L1-Letter-light.png`/dark.

**Where/wrong:** `apps/android/feature/letters/src/main/kotlin/me/rxresu/feature/letters/LetterViewModel.kt:64` rasterizes only page 0 while retaining pageCount; `apps/android/feature/letters/src/main/kotlin/me/rxresu/feature/letters/LetterScreen.kt:48` draws one paper image with vertical scroll but no page loop or transform gesture. A multi-page letter exports content the person cannot review.

**Expected/fix/verify:** SCREENS L1 requires Builder-like page interaction. Reuse multi-page/zoom infrastructure. Open a two-page letter with distinctive second-page text, pinch fit→200%, inspect both pages and compare exported PDF. Repeat last-good offline render.

## Applications and Workspace

### R17 — Major — Applied confirmation cannot select documents actually sent

**Screen/capture:** W2 `workspace/W2-Apply-light.png`/dark; confirmation not separately captured.

**Where/wrong:** `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/ApplyTab.kt:386` supplies summary and confirm only; `:166` always submits currently linked resume/letter as `expectedDocuments`. If the person sent a different resume or omitted the linked letter, the immutable submission record claims the wrong documents.

**Expected/fix/verify:** SCREENS W2 explicitly asks which documents were actually sent. Reuse J7's selection pattern, preserving expected-current-document concurrency validation separately from submitted choices. Link tailored+letter; confirm base resume/no letter; inspect saved submission/history after reload. Test a concurrent link change too.

### R18 — Major — Prep cannot choose another round or inspect company sources

**Screen/capture:** W3 `workspace/W3-Prep-light.png`/dark; reference offers source access, capture only Posting.

**Where/wrong:** `apps/android/feature/workspace/src/main/kotlin/me/rxresu/feature/workspace/PrepareTab.kt:92` selects current/last interview without selected-round state. `:245` renders summary and `:249` one inert Posting chip, with no briefing-source links. Multiple rounds cannot be deliberately reviewed; research claims lack source access.

**Expected/fix/verify:** SCREENS W3 round picker/source evidence. Carry selected interview identity through load/generate/save; render saved sources with safe browser actions. Seed two distinct rounds and two source URLs, choose each/reload/open sources; assert no cross-round briefing mix-up.

### R19 — Major — Trash Undo dies with popped detail screen

**Screen/capture:** J6 `applications/J6-Detail-light.png`/dark → J1.

**Where/wrong:** `apps/android/feature/applications/src/main/kotlin/me/rxresu/feature/applications/ApplicationScreen.kt:161` launches in composition scope, pops at `:164`, then suspends in `toasts.show` at `:165`. `apps/android/core/designsystem/src/main/kotlin/me/rxresu/core/designsystem/RrToast.kt:115` cancels/removes toast with caller cancellation. Host-owned `post` at `:138` already supports surviving a closing caller. After composition disposal, Undo can vanish or never untrash.

**Expected/fix/verify:** J6 destructive action must retain promised Undo. Use app-owned posting/restoration independent of disposed detail model. Trash, wait until pop finishes, tap Undo and reload J1; assert exactly one untrash even if another screen opens. PLAN's older toast-service backlog does not excuse this caller-lifetime defect now that service exists.

### R20 — Minor — Insights omits Pipeline flow and statistic definitions

**Screen/capture:** J4 `applications/J4-Insights-light.png`/dark.

**Where/wrong:** `apps/android/feature/applications/src/main/kotlin/me/rxresu/feature/applications/InsightsView.kt:102` supports only OverTime/Sources; `:158` renders those choices and `:187` inert stat cards. Pipeline flow, Save image and tappable definitions from SCREENS J4 are missing. CSV parity exception does not waive image export/definitions.

**Fix/verify:** Add missing chart/action/definitions using current aggregation/shared UI. Check multi-stage fixture, denominator definitions, exported PNG and specified empty state.

## Career

### R22 — Major — Every keystroke can perform synchronous disk fsync on main

**Screens/captures:** C2 `career/C2-Coach-light.png`, C4 `C4-Story-light.png`, C5 `C5-Preferences-light.png`, dark too. **May be addressed by C-R2.**

**Where/wrong:** `apps/android/feature/career/src/main/kotlin/me/rxresu/feature/career/CareerModels.kt:41` writes synchronously and calls `fd.sync()` at `:44`. Text callbacks invoke it directly at `:167`/`:203` and `apps/android/feature/career/src/main/kotlin/me/rxresu/feature/career/CoachModel.kt:88`. The 500 ms debounce delays network saving, not this disk operation. Slow storage can block Compose input/rendering and cause ANR.

**Expected/fix/verify:** SCREENS C4 typing must remain natural; recovery durability cannot block UI. Move ordered I/O to background ownership without losing latest-write/error semantics. Use StrictMode/tracing and injected slow writer; type long draft, leave/recover and assert no main-thread disk writes or stale recovered text.

### R23 — Major — Career offline recovery is not a retry queue

**Screens/captures:** C4/C5 `career/C4-Story-light.png`, `C5-Preferences-light.png` and dark; no offline capture. **May be addressed by C-R2.**

**Where/wrong:** `apps/android/feature/career/src/main/kotlin/me/rxresu/feature/career/CareerModels.kt:173`/`:209` attempts direct save once and leaves `KeptOnDevice` after failure. Reconnect/WorkManager at `apps/android/core/data/src/main/kotlin/me/rxresu/core/data/RealRepositories.kt:34`/`:44` handles resume/letter queue only. CareerDrafts has no retry owner; preferences fetch remote state before exposing recovered state at `apps/android/feature/career/src/main/kotlin/me/rxresu/feature/career/CareerModels.kt:195`. Reconnect/restart does not automatically deliver these edits, and offline reopening can fail before showing recovery.

**Expected/fix/verify:** SCREENS C4 queues offline like documents; HANDOFF §4 calls for durable retries. Integrate an account-scoped queue with conflict/error semantics and explicit sign-out retention/cleanup policy. Offline-edit, close/kill, reconnect without reopening and assert server persistence. Reopen while still offline and assert recovered draft visible. Account hashing prevents cross-account display but is not delivery; `KeptOnDevice` is not synced.

## Public and Settings

### R24 — Major — ATS verdict and celebration disagree with web

**Screen/capture:** P2 `public/P2-ATS-light.png`, dark/signed-out captures. **May be addressed by C-R2.**

**Where/wrong:** `apps/android/feature/public/src/main/kotlin/me/rxresu/feature/publiclink/PublicScreens.kt:174` uses score-only thresholds 80/60; `apps/android/feature/public/src/main/kotlin/me/rxresu/feature/publiclink/PublicGraph.kt:75` emits Success for any score ≥80. Web owner `packages/resume/src/ats-pdf/verdict.ts:13` requires ≥80 **and no findings** for clean, and uses 50 for mostly. 86+warning wrongly says clean/celebrates; 55 wrongly says hard. Web wins even where a sample board label differs.

**Fix/verify:** Match shared verdict contract and derive headline/haptic from it. Cases: 86+finding → mostly/no success; 86+empty → clean/success once; 55 → mostly; 49 → hard. Stable result recomposition must not repeat feedback.

### R25 — Minor — Theme switches without required d2 crossfade

**Screen/capture:** S3 `settings/S3-Preferences-light.png`/dark. **May be addressed by C-R2.**

**Where/wrong:** `apps/android/app/src/main/kotlin/me/rxresu/RrApp.kt:79` selects palette directly for `RrTheme` at `:85`; no app transition installed. SCREENS S3 requires d2 crossfade in normal motion, instant only when reduced. White paper is correctly retained.

**Fix/verify:** Use shared theme fade, instant under reduced. Record Light→Dark→Match system and inspect intermediate frames including open sheet; paper remains white.

### R26 — Minor — Invalid profile field scrolls to unrelated top

**Screen/capture:** S4 `settings/S4-Profile-light.png`/dark. **May be addressed by C-R2.**

**Where/wrong:** `apps/android/feature/settings/src/main/kotlin/me/rxresu/feature/settings/ProfileScreen.kt:42` always calls `scroll.animateScrollTo(0)` on invalid state. A salary/reference/link error below fold sends the person to unrelated contact fields. SCREENS S4 requires the invalid field brought into view with inline error.

**Fix/verify:** Track/focus/bring into view first invalid field, honoring reduced motion/IME. Save bad salary/reference at 100%/200%; assert exact control/error visible and announced.

## System surfaces

### R28 — Minor — X1 golden exercises illustration, not shipping widget

**Screen/capture:** X1 `system/X1-Notify-light.png`/dark.

**Where/wrong:** `apps/android/feature/system/src/test/kotlin/me/rxresu/feature/SystemScreenshotsTest.kt:22` captures Compose `SystemContent`; shipping Glance `apps/android/feature/system/src/main/kotlin/me/rxresu/feature/system/TodayWidget.kt:76`/`:81`/`:91` uses platform Serif/Monospace and fixed 44 dp rows instead. The illustration does not establish real widget typography/layout/200% fidelity. HANDOFF X1 requires token layout in both themes. Native notification chrome is system-owned, not a visual defect.

**Fix/verify:** Render/test actual Glance/RemoteViews variants at supported sizes, both themes, long names, 200% and signed out. Resolve custom-font platform constraints explicitly with lead; do not present illustration as widget proof. Device gate must verify title/row targets and launcher deep links.

## Screen-by-screen coverage

Every row's light **and** dark baseline was compared with its matching reference. `±` means both `-light.png` and `-dark.png`. I/H/M/S refer to SCREENS Interactions/Haptics/Motion/States. **Present** means implementation paths found in source, not device acceptance. **Partial** calls out findings, known gaps or specifically unverified requirements. Shared findings apply wherever their components occur. “No new finding” is not a blanket pixel-perfect or runtime sign-off.

| ID  | Module / baseline capture           | I / H / M / S disposition                                                                                                                                                                                                                                                      |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | auth / `A1-Welcome-±.png`           | I: server/continue/PDF paths present. H: selection/error present. M: welcome/server-field paths present. S: health failure/session routing present; guest exception known.                                                                                                     |
| A2  | auth / `A2-SignIn-±.png`            | I: password/social/register/reset paths present. H: error path present. M: loading/error paths present. S: Error/Forgot/Register/Reset extras inspected; font200 inspected. C-R2 area.                                                                                         |
| A3  | auth / `A3-TwoStep-±.png`           | I: code/paste/backup paths present. H: error path present. M: ring/caret partial, already PLAN. S: mismatch/expired/rate limit source paths; Backup extra inspected. C-R2 area.                                                                                                |
| A4  | auth / `A4-Allow-±.png`             | I/H: real completion uses browser fallback, known PLAN gap. M: modal path present. S: loading/invalid/fallback source paths; Browser extra inspected. C-R2 area.                                                                                                               |
| T1  | today / `T1-Today-±.png`            | I: open/refresh/reselect/roles/swipe paths present; visible read alternative missing R07. H: action/threshold paths. M: shared header/list paths. S: Error/Offline extras and font200 inspected.                                                                               |
| T2  | today / `T2-FirstRun-±.png`         | I: checklist destinations/notification request present. H: completion path. M: checklist transition path. S: first-run/permission handling present, native guest excluded by known decision.                                                                                   |
| D1  | documents / `D1-Library-±.png`      | I: open/actions/filter/list-grid/select/refresh paths present. H: shared chip/long-press/swipe. M: filter transition present, reduced placement wrong R10. S: Empty/Error/List-offline extras/font200 inspected.                                                               |
| D2  | documents / `D2-Actions-±.png`      | I: share/rename/duplicate/trash/link paths present. H: action feedback. M: shared sheet. S: preparing/locked paths, Locked extra inspected. Server rendering is approved HANDOFF default.                                                                                      |
| D3  | documents / `D3-New-±.png`          | I: step/import/blank/copy/letter paths present, dirty exit wrong R06. H: creation feedback path. M: step/detent paths. S: copy failure retains fields while open; dismissal loses them.                                                                                        |
| D4  | documents / `D4-Import-±.png`       | I: read/create paths present, file identity/bounds wrong R04/R05. H: result/error paths. M: step/summary paths. S: unreadable/no-basics/no-sections source paths. Server-reader copy is known PLAN decision; AI approval R01.                                                  |
| D5  | search / `D5-Search-±.png`          | I: scoped/keyboard/open/Ask paths present. H: chip selection, typing quiet. M: presentation/results paths. S: Empty-query/No-matches extras inspected. Broader seeded results are not a defect.                                                                                |
| D6  | documents / `D6-Trash-±.png`        | I: restore/select/delete/hold paths present. H: hold/restore paths. M: shared dialog/hold. S: Empty and confirmation inspected. Hold time remains unscaled 1.2 s.                                                                                                              |
| B1  | builder / `B1-Page-±.png`           | I: pick/zoom/assistant/menu present. H: duplicate selection R12. M: image swaps/page paths present; thumbnail shared-element transition missing R29. S: Agent/Loading/Locked/Not-saved/Offline extras inspected. Paper stays white.                                            |
| B2  | builder / `B2-Entry-±.png`          | I: live edit/stepping/date/actions present. H: shared detent/action paths. M: picked-block clearance wrong R08. S: empty/date/locked source paths, font200 inspected.                                                                                                          |
| B3  | builder / `B3-Outline-±.png`        | I: reorder/menu/add/edit present; cross-group Move-to exists, direct cross-group drag missing R30. H: lift/slot/drop paths. M: neighbour reduced defect R10. S: hidden-placement/action semantics present.                                                                     |
| B4  | builder / `B4-Improve-±.png`        | I: rich edit/improve/replace/keep/retry paths present. H: replace/error. M: proposal/text paths. S: stale/failure checks present. AI approval R01.                                                                                                                             |
| B5  | builder / `B5-Basics-±.png`         | I: basics/photo/crop present, inaccessible pan R13 and bound R05. H: action paths. M: editor/shared paths. S: image failure source paths; Crop light/dark inspected.                                                                                                           |
| B6  | builder / `B6-Template-±.png`       | I: template/favourite/preview present. H: duplicate segments R12. M: preview path. S: long-list/locked source paths inspected; white previews match kit.                                                                                                                       |
| B7  | builder / `B7-TypePage-±.png`       | I: font/page/stepper present. H: shared steps, duplicate selections R12. M: control/preview paths. S: input/locked source paths inspected.                                                                                                                                     |
| B8  | builder / `B8-Layout-±.png`         | I: zones/menu present; canceled drop wrong R09. H: lift/slot/drop plus R12. M: lifted rotation R10. S: hidden/placement paths.                                                                                                                                                 |
| B9  | builder / `B9-Issues-±.png`         | I: issue/edit/category/writing present. H: shared action paths. M: size animation R10. S: Empty/Writing extras inspected, score/error source paths. AI approval R01.                                                                                                           |
| B10 | builder / `B10-JobMatch-±.png`      | I: link/change/paste/add/save-job present. H: shared actions. M: panel paths. S: Change/Not-linked/Save-job extras inspected. Mechanical matching distinguished from AI writing.                                                                                               |
| B11 | share / `B11-Share-±.png`           | I: PDF/download/public/activity paths present. H: completion/toggle paths. M: shared controls. S: Private extra/font200 inspected; dark paper thumbnail white.                                                                                                                 |
| B12 | share / `B12-WebPage-±.png`         | I: address/privacy/password/domain paths present. H: save/toggle paths. M: shared sheet/control. S: validation/copy/locked source paths inspected.                                                                                                                             |
| B13 | share / `B13-Visitors-±.png`        | I: visitor/feedback/comment paths present. H: action paths. M: shared panels. S: loading/empty/comment paths; feedback PDF known gap.                                                                                                                                          |
| B14 | share / `B14-Download-±.png`        | I: formats/save/share/print paths present. H: completion/error paths. M: shared progress. S: preparation/failure source paths. Platform completion not run.                                                                                                                    |
| B15 | share / `B15-Versions-±.png`        | I: list/name/use/delete paths present. H: action feedback. M: shared sheet. S: historical PDF unavailable, already PLAN; no claim historical preview works.                                                                                                                    |
| B16 | assistant / `B16-Assistant-±.png`   | I: send/context/history/stop/source/answer present; setup stale R21. H: send/error paths. M: streaming/Latest source paths. S: Failure/Locked/Streaming extras inspected. Approval R01.                                                                                        |
| B17 | assistant / `B17-Proposals-±.png`   | I: accept/reject/edit/bulk plus gesture alternatives present; dirty wording R14. H: decision paths. M: status transitions. S: stale/new-detail/locked/failure source paths, font200 inspected.                                                                                 |
| B18 | share / `B18-More-±.png`            | I: document/lock/export actions present. H: shared action paths. M: menu/sheet. S: locked/error source paths inspected.                                                                                                                                                        |
| L1  | letters / `L1-Letter-±.png`         | I: details/draft/export present, rich edit/pages wrong R15/R16. H: save/AI paths. M: single-page preview only. S: draft failure/recovery paths, font200 details inspected. Approval R01.                                                                                       |
| L2  | letters / `L2-LetterDesign-±.png`   | I: typography/page/accent/signoff present. H: shared controls. M: preview/control paths. S: locked/save source paths. Dense form lacks font200 capture.                                                                                                                        |
| J1  | applications / `J1-List-±.png`      | I: list/filter/actions/select present. H: move/swipe/shared controls. M: view/list paths. S: Empty extra inspected; font200 fails R11, dark danger R27.                                                                                                                        |
| J2  | applications / `J2-Board-±.png`     | I: drag plus Move-to menu present. H: move paths. M: shared/view paths. S: lanes/count/empty source paths. Selector R11.                                                                                                                                                       |
| J3  | applications / `J3-Calendar-±.png`  | I: date/interview/calendar paths present. H: shared selection. M: view paths. S: account timezone wrong R02; selector R11.                                                                                                                                                     |
| J4  | applications / `J4-Insights-±.png`  | I: over-time/sources present; pipeline/definitions missing R20. H: shared controls. M: view paths. S: aggregation/empty source paths; selector R11.                                                                                                                            |
| J5  | applications / `J5-SaveJob-±.png`   | I: capture/stage/save present. H: save/error paths. M: shared sheet. S: Blank extra inspected; capture-failure manual entry present. No font200 sheet.                                                                                                                         |
| J6  | applications / `J6-Detail-±.png`    | I: overview/tabs/contact/update/reopen present; Trash Undo wrong R19. H: action paths. M: shortcut reduction wrong R10. S: Closed/Fit-tab/Follow-up extras inspected; Fit-only fixture does not prove workspace slot.                                                          |
| J7  | applications / `J7-Stage-±.png`     | I: stage/outcome/applied document selection present. H: move paths. M: sheet/stepper. S: stage words/outcomes present.                                                                                                                                                         |
| J8  | applications / `J8-Interview-±.png` | I: date/time/type/contact/calendar present. H: shared picker/save. M: sheet paths. S: New extra inspected; account timezone R02.                                                                                                                                               |
| W1  | workspace / `W1-Fit-±.png`          | I: check/evidence/actions present. H: result/error paths. M: shared state paths. S: First-run/No-AI/font200 inspected; approval R01.                                                                                                                                           |
| W2  | workspace / `W2-Apply-±.png`        | I: answer/review/copy/submit present, sent chooser missing R17. H: action paths. M: shared panels/sheets. S: answer/submit-failure source paths; approval R01.                                                                                                                 |
| W3  | workspace / `W3-Prep-±.png`         | I: generate/practice/calendar present, round/source access missing R18. H: result/error paths. M: shared state paths. S: No-interview extra inspected; approval R01.                                                                                                           |
| W4  | workspace / `W4-Practice-±.png`     | I: record/type/review/attempts present. H: recording/limit/result paths. M: static meter under reduction present. S: Idle extra and mic/empty/size source paths; STOP cancels recording. Approval R01.                                                                         |
| W5  | workspace / `W5-Messages-±.png`     | I: draft/edit/mail/copy/log/debrief/library present. H: copy/log/result paths. M: draft/kind paths. S: Debrief/Library light/dark and Library-empty extras inspected. Library fixtures sometimes highlight adjacent tab; fixture chrome is not navigation proof. Approval R01. |
| C1  | career / `C1-Career-±.png`          | I: starters/history/Knowledge/offers/schedules present. H: navigation quiet/pull path. M: header/starters paths. S: Empty extra inspected; rich-chat/date/chip gaps already PLAN. C-R2.                                                                                        |
| C2  | career / `C2-Coach-±.png`           | I: send/remember/history/recovery present. H: send/remember/error. M: stream/scroll source paths. S: Knowledge/provider guards present; main-thread recovery R22. C-R2.                                                                                                        |
| C3  | career / `C3-Facts-±.png`           | I: correct/forget/import-review present. H: save/forget paths. M: shared list/sheet paths. S: empty/filter source paths. C-R2.                                                                                                                                                 |
| C4  | career / `C4-Story-±.png`           | I: edit/link/delete present; native practice known gap. H: typing quiet. M: form paths. S: offline delivery incomplete R23; main-thread fsync R22. C-R2.                                                                                                                       |
| C5  | career / `C5-Preferences-±.png`     | I: roles/places/requirements/suggestions present. H: step/remove paths. M: chip/form paths. S: invalid-amount/failure paths, font200 inspected; R22/R23. C-R2.                                                                                                                 |
| C6  | career / `C6-Offers-±.png`          | I: compare/edit/swap/questions/coach present. H: save/copy paths. M: swap crossfade. S: missing/uncertain/incompatible terms source paths. C-R2.                                                                                                                               |
| C7  | career / `C7-Schedule-±.png`        | I: modes/save/delete/discard present. H: selection/toggle/save paths. M: field/sheet paths. S: availability/email/provider guards; timezone R02. C-R2.                                                                                                                         |
| S1  | settings / `S1-Settings-±.png`      | I: modal rows/about/close present. H: navigation quiet. M: modal paths. S: Offline extra inspected, provider state paths; guest excluded. C-R2.                                                                                                                                |
| S2  | settings / `S2-Account-±.png`       | I: account/export/sign-out present; security browser exceptions known. H: save/error paths. M: shared dialogs/hold. S: verification/email capability source paths. C-R2.                                                                                                       |
| S3  | settings / `S3-Preferences-±.png`   | I: theme/language/timezone/notifications/haptics present, timezone owner R02. H: shared controls. M: fade missing R25, system precedence R10. S: permission/failure source paths, font200 inspected. C-R2.                                                                     |
| S4  | settings / `S4-Profile-±.png`       | I: form/save/discard/manage present. H: save/error. M: invalid-field scroll wrong R26. S: validation/reload paths. C-R2.                                                                                                                                                       |
| S5  | settings / `S5-AI-±.png`            | I: provider/test/default/delete/developer paths; browser key exception known. H: test paths. M: status paths. S: Loading extra inspected; unavailable/error paths. C-R2.                                                                                                       |
| S6  | settings / `S6-Provider-±.png`      | I: provider/key/base/model/test/save present. H: selection/test. M: shared field/sheet paths. S: Error extra and key/base guards inspected; Assistant return stale R21. C-R2.                                                                                                  |
| P1  | public / `P1-Public-±.png`          | I: viewer/password/comments/download/zoom paths present; endpoint PDF restrictions known. H: completion paths. M: still page/modal. S: Password light/dark extras and unavailable-link source paths. C-R2.                                                                     |
| P2  | public / `P2-ATS-±.png`             | I: file/sample/views/check/import present; native server-check disclosure differs from local storyboard deliberately. H/S: verdict wrong R24. M: ring/view paths. Signed-out extras inspected; endpoint public despite stale PLAN. C-R2.                                       |
| X1  | system / `X1-Notify-±.png`          | I: notification/widget/shortcut links present in source. H: system-owned. M: route transition paths. S: permission/signed-out source paths. Actual widget rendering unproved R28.                                                                                              |

### Font scale, RTL and tokens

Only A2, T1, D1, B2, B11, B17, L1, J1, W1, C5 and S3 have committed feature font200 captures; **50 IDs have none**. Prioritize B4 toolbar, B5 basics/crop, B7 typography, L1 body/recipient editors, L2 design, D3 copy/letter steps with long lists, J5/J8, C6's three-column comparison and S6 setup. Fixed side-by-side controls and unscrollable nested forms are risks; absent captures alone do not prove failure. R11 is directly visible. Assert every primary control remains reachable rather than accepting overflow into a new golden.

Source uses logical start/end and mirrored shared directional icons. B5 email/phone/website explicitly force LTR (`apps/android/feature/builder/src/main/kotlin/me/rxresu/feature/builder/Basics.kt:108`/`:112`/`:116`); S4 email/phone do too (`apps/android/feature/settings/src/main/kotlin/me/rxresu/feature/settings/ProfileScreen.kt:145`/`:157`). Shared `RrSwipeRow` converts physical drag deltas to logical offsets; its RTL path is not a finding. Mixed-direction free text, cursor behaviour, embedded contacts and B8 physical drag coordinates still need an RTL run. No RTL screenshot set exists; this is not an RTL/TalkBack sign-off.

WCAG ratios computed from opaque token pairs: linearize sRGB (`c/12.92` below 0.04045, otherwise `((c+0.055)/1.055)^2.4`), luminance `0.2126R+0.7152G+0.0722B`, ratio `(Lmax+0.05)/(Lmin+0.05)`.

| Pair                    | Light |           Dark |
| ----------------------- | ----: | -------------: |
| ink / bg                | 16.10 |          16.52 |
| ink2 / raised           |  8.45 |           8.60 |
| ink3 / bg               |  4.92 |           6.40 |
| ink3 / surface          |  5.19 |           6.05 |
| ink3 / raised           |  5.27 |           5.57 |
| ink3 / sunken           |  4.58 |           6.61 |
| controlBorder / raised  |  3.64 |           3.46 |
| onAccent / accent       |  5.57 |           8.51 |
| onDanger / danger       |  5.74 | **3.95 — R27** |
| accentText / accentSoft |  6.82 |           7.93 |
| dangerText / dangerSoft |  6.04 |           7.18 |
| warnText / warnSoft     |  5.77 |           8.59 |
| infoText / infoSoft     |  6.14 |           7.90 |

This does not certify arbitrary alpha/disabled/over-image combinations. Low-contrast line/line2 is decorative; operable controls use controlBorder. Unscaled PDF preview content is distinct from interface labels.

Production feature Kotlin scans found no Material3/material.icons imports, raw `Color(0x...)` or feature-local `RoundedCornerShape(...)`. Dimension scans were assessed against board sizes as well as named constants; raw `.dp` on a documented board size is not automatically a defect. Captures retain functional Figtree, Instrument Serif titles/numbers without bold, small corners and white paper. No new authored emoji/exclamation/all-caps/non-AI-sparkle finding established; brand names/acronyms and user document content excluded. Selection/progress accent fills were not counted as additional primary actions. R28 is the actual-widget typography exception.

## Verified OK and exclusions

- Shared icon controls have labels/minimum targets; switches/checkboxes/radios expose state and sliders expose setProgress. Swipe semantics have TalkBack custom actions. B3/B8 move menus and J2 Move-to alternatives exist; B5/T1 exceptions are R13/R07. Actual focus order/target overlap remains unverified.
- Toast and working status use polite live regions. Stages include names with dots/steps rather than colour alone. Shared sheets/dialogs/menus/toasts retain unscaled d1 reduced fades; spinners keep turning. Hold-to-delete keeps 1.2 s. W4 reduced waveform is static meter; record control is 72 dp square/4 dp corners.
- Practice recorder stops on lifecycle STOP, enforces 120 s/2 MB and cancels on teardown. No background-mic leak established. Production Kotlin scans found no Log/println/System.out calls; source scan is not logcat/network proof or a complete sensitive-data audit.
- No companion-object route crash established: `Offers` is a serializable data object, so `navigate(Offers)` is valid. Document sorting is server/repository-driven; a local presentation filter key does not establish a sort defect.
- Known PLAN exclusions not counted anew: browser consent/security/API keys; native guest absence; saved-version/feedback PDF endpoints; public download permission; App Links deployment config; career date/rich-chat/chip/native-practice gaps; API 26–32 locale; OTP caret/ring. `packages/api/src/features/resume/checks.ts:49` is now publicProcedure: PLAN's signed-out REST-PDF-check authentication note is stale and not a finding.
- Fixture-only counts, provider names and extra seeded search results were not treated as product defects. W5 Library selected-tab chrome and X1 illustration need better fixtures before their screenshots establish actual navigation/platform fidelity.

Release acceptance remains open: fix findings, rerun gates at resulting pin, then lead-owned device/API smoke, TalkBack, font200/RTL/IME, physical haptics and real widget/notification checks. Green JVM/golden checks at this pin do not close those gates.
