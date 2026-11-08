# Fidelity run log

## 2026-11-08 — Foundation harness proof

- Command: `./gradlew :feature:today:testDebugUnitTest --tests '*TodayScreenshotTest*'`, then
  `python3 <bundle>/tools/fidelity.py build/fidelity build/fidelity-report --only T1-Today,T2-FirstRun`.
- Test execution passed. Strict fidelity: **0/2 pass**.
- T1: 44 layout failures / 6 correct; light 5.94%, dark 6.25%, six solid bands.
- T2: 34 layout failures / 5 correct; light 9.48%, dark 14.04%, twelve solid bands.
- Foundation components were still in progress; feature screens remained v1.
- Read T1 layout report and opened its light composite. Root title position/line height nearly matches,
  but actions, hero structure, list margins/spacing and bottom dock differ. No fidelity approval.
- Captures and JSON come from the rendered view's unmerged semantics, independently of expected layouts.

## 2026-11-08 — Foundation metrics and fake fixtures

- Native xhdpi metrics: 31 styles × one/three lines × both themes; exact line boxes passed.
- Structured dump proof checks actual Card, text, labeled/decorative icons, token metadata and duplicate suppression.
- Full core testing/data/page run: 38 tests, zero failures/errors/skips (5 + 22 + 11).
- First Kit capture: 1.23% pixel difference; not accepted. Independent reviewer confirmed right-column drift,
  incorrect blocked-composer icon, absent caret, marker shape and toast geometry/shadow differences.
- Owner resolved navigation contradictions: all ellipses open B19; Typography/Page are pushed pickers.

## 2026-11-08 — Foundation fix rounds

- Kit measured 1.23% → 0.67% → 0.30% → 0.12% at mdpi, then 0.06% at phone-matching xhdpi
  with explicit Roborazzi 0.5 export to 2240×1400. Final report has no flagged bands.
- Causes fixed: subpixel glyph advances (same sizes/tracking), consumed row borders, dock/footer divider
  allocation, parent-clipped toast shadows, control radii, composer icon, insertion caret, marker shape,
  component names/semantics and safe areas. No reference files or tolerances changed.
- Kit renders real components at xhdpi; its measured JSON stays in dp. Export scaling affects only Kit.
- Final component run: 43 tests passed, zero failures/errors/skips; lint passed.
- Core testing/data/page verification and testing lint passed; native scroll tests cover plain lists,
  a 96-row lazy list, horizontal-only and fitting content. Scroll-end screenshots produced 780×1688.
- Kit SHA256: `e2c4cf76d33a6b0fd1c691bb557c481435f806d8dc22b11b8a5e51fd80db8a26`.
- Fresh final independent Kit reviewer inspected all components in both themes and six enlarged paired regions:
  no remaining visible findings within the 1 dp/glyph-antialiasing contract. Verdict applies only to pinned Kit;
  feature-screen fidelity and device behavior remain unverified.

## 2026-11-08 — Navigation registration proof

- Added typed section/design/preview/workspace destinations and pushed/modal registration. Preserved legacy
  application link arguments; consumed forwarding once so Back returns to J6 without reopening a workspace.
- Four tests execute the same `appDestinations` registration boundary as production with real feature graphs:
  section/entry/design Back behavior; all seven workspace tools and question identity; legacy-link Back;
  full-screen assistant/preview/provider versus the formats sheet. All four passed.
- Initial app test execution exposed missing JDK module-open flags; applied existing library-test JVM flags
  to the app test task, then reran successfully. No assertion or tolerance changed.
- These tests establish registration/argument/back-stack behavior. Full 210-edge callback coverage and
  remaining v1 UI removal stay open through feature integration.

## 2026-11-08 — First feature integration and approved raster proof

- Auth/settings worker commit merged: all 20 theme captures pass pixel thresholds (0.02–0.73%, zero bands),
  but strict layout acceptance is only 1/10 screens. Nine geometry failures remain; no screen approval inferred
  from pixel thresholds. Shared measurement/component causes are being fixed before repeating captures.
- Owner approved scaled-text exporter correction: B1 24 records and B6 18 records, preserving original boxes,
  glyph x/width, PNGs and 1 dp tolerance. Repeated export produces zero changes. Browser regression test passes.
- Owner approved exact raster proof: actual decoded RGBA SHA256 and dimensions plus measured image bounds cover
  baked raster descendants. Seven packaged fixtures verified byte-for-byte. Seven comparator regression tests
  reject wrong/missing hashes, wrong dimensions, moved images and displaced native text; annotation is idempotent.
- All 127 original screen/board PNG SHA256 hashes remain unchanged. Native raster/dump proof is still running;
  no feature raster acceptance claimed yet.

## 2026-11-08 — Shared measurement and auth/settings fix round

- Strict selected scoreboard: **10/10 pass**, A1–A4 and S1–S6, both themes; zero layout failures/bands.
  Pixel differences 0.02–0.69%. Independent full screen review is running; this is measured acceptance only.
- Root causes fixed at shared boundary: inner row tags separate from full-width touch targets; real input/picker
  slots; actual annotated-span range bounds/colors; unclipped layout positions that retain real scroll transforms.
- A4 untinted logo32 in tile56 and two-line row73; S5 truthful icon16×36 slot with16dp top glyph.
- Core testing16, designsystem44 (including native raster hash/chunk proof), data24, auth28, settings56 and today14
  tests passed. System suite initially found omitted legacy channel; retained channel for old supported callers,
  preserving notification privacy assertions. Final data24/system30/settings56 rerun passed, zero failures/errors/skips. No tests skipped/weakened to obtain acceptance.
- Follow-ups and Offer deadlines now independent persisted categories; legacy combined membership expands to both.
  Migration preserves unknown stored categories, and tests prove independent toggles after migration.

## 2026-11-08 — Auth/settings independent review fix round

- Fresh reviewer inspected20 composites,40 originals and8 available scroll ends. Found2 structural extras:
  account controls after S2 Delete account, and S4 undrawn Manage profile/details row.
- Removed root additions. Account details retain native controls inside existing Username sheet; profile advanced
  editor remains accessible from Full name. Two meaningful interaction regressions verify reachable behavior.
- Serialized settings run:58 tests, zero failures/errors/skips. Initial S2/S4 strict2/2 pass, zero layout failures/bands.
- Found stale generated end files from earlier scrollable roots; quarantined them. Current roots fit viewport.
  Shared capture now removes only its own previous artifacts before a targeted run; regression proof is pending.
- New independent reviewer inspected all4 changed composites,8 originals and current measured JSON, pinned hashes:
  no remaining findings in S2/S4. Earlier8 assigned screens had no findings. This covers10 screens, not all62.
- One same-checkout overlapping compile failed with missing AccountAvatarKt.class; serialized rerun passed.
  Shared-checkout builds are now explicitly scheduled one at a time; separate worktrees continue independently.

## 2026-11-08 — Today/documents/search first integration

- Worker rebuilt8 screens, all16 themes under pixel threshold with zero bands, but0/8 strict on pre-fix core.
- Shared row/input/unclipped fixes are already integrated; thumbnail and monogram fixes are underway.
- Targeted inherited reduced-motion regression reproduced unchanged: sheet Open callback0 instead of1.
  No assertions skipped/weakened. Parent tracing first-layout/animation geometry before retest.
- D4 desired local PDF read agrees with web. Existing Android quick read uploads raw PDF to server, so truthful
  server copy remains while actual local parser is implemented. No owner direction question is needed.

## 2026-11-08 — Today/documents/search measured fix round

- Shared fixes: exact white DocThumb metadata/outer ring/rounded bars; supported two-letter monograms and
  Instrument Serif18/16 step numerals; search usesLU, Today role usesKS. Defaults preserved.
- Reduced-motion root cause: fixed-height sheet first measured0height before entry coroutine ran. Measure resting
  anchor immediately; unchanged formerly failing Open callback regression now passes (targeted19s run).
- Capture hygiene regression proves a fitting screen deletes its own old endPNG/JSON without touching sibling
  screens. Core testing17, designsystem47, data30, today17, search13, documents60:184 tests, zero failures/skips.
- T1 had2missing New roles/count nodes beneath dock because LazyColumn had not composed that section. Today now
  lays out its dashboard as one scroll page, retaining native coordinates for all headings and tab-reselect behavior.
  Today17 tests passed after this change; no synthetic/invisible measurement nodes were added.
- Selected strict scoreboard: **8/8 pass**, T1/T2/D1–D6, both themes, zero layout failures/bands; pixels0.04–0.15%.
  Independent8-screen visual review in progress. Together with auth/settings,18 screens have measured acceptance.
- Kit capture SHA remains e2c4cf76d33a6b0fd1c691bb557c481435f806d8dc22b11b8a5e51fd80db8a26.
- Production search now includes persisted MessageDraft title/incoming/reply with application identity, using existing
  store/cache and account guards. Six owner-path tests passed; no fictional note type or API/schema change.
- Actual local import engine/browser/native-host tests passed; independent review found mixed scanned/text PDF
  silent partial extraction. That finding is being fixed before local-reader acceptance or device proof.

## 2026-11-08 — Builder, assistant, share and letter shared fix rounds

- Combined serialized verification: **512 tests across 12 modules**, zero failures/errors/skips; debug APK assembled.
  Designsystem63, data31, testing19, page11, builder108, today18, share44, letters39, assistant53,
  career67, public27, system32. Detailed XML and log retained under
  `/Users/amruth/.codex/artifacts/android-ca3a733c-2026-11-08/shared-ui-final-verification.log`.
- Builder strict sequence: 6/10 → 9/10 → **10/10**, all themes, zero layout failures/bands, maximum0.19%.
  Final native wrapped-mark regression plus existing DS checks:64 tests; builder108 tests passed.
  Actual TextLayoutResult proves12dp paragraph gaps and2dp wrapped changed-word inset. Page band border allocation,
  outside thumbnail rings, toolbar, typography tracking and white paper metadata corrected in shared components.
- Share/letters strict sequence:0/8 →6/8 → **8/8**, all themes, zero layout failures/bands, maximum0.16%.
  Corrected native address field metrics, option rows,500-weight format labels, analytics sum128, menu border,
  letterhead trailing gap and root-only extra letter controls. Existing Details sheet retains those actions.
- Assistant B16/B17: **2/2**, zero layout failures/bands. Pixel differences .42/.41% and .31/.32%.
  Native proposal spans retain reconstructed before/after text. Missing production page-fit measurement displays
  truthful unknown status; only storyboard fake supplies the drawn1→1 result.
- Capture lifecycle root cause: ActivityScenario with manual looper pulses did not own the Compose frame clock.
  Supported Compose UI test environment now owns recomposer/frame clock; strict native scroll assertions retained.
  Wrong-clock mutant makes2/2 new regressions fail; restored harness passes19/19. Assistant53/53 passed.
- Every failing layout report was read and all changed composites/end captures inspected by implementers.
  Fresh independent builder/assistant/Today review is running; numerical success is not visual-review approval.
- Fresh career/public/system selected run: **5/10**. C1/C4/C6/P1/P2 pass. C2 has7 layout failures;
  C3/C5 two each; C7 five plus4 bands; X1 has31 missing native nodes. Follow-up fixes in progress.
- All above are selected, mixed-time runs, **not a final clean62-screen run**. Applications/workspace integration,
  final full checks and device proof remain outstanding. Device install was refused with DEVICE_IN_USE for another
  workspace; no existing device session was reused or closed.

## 2026-11-08 — Final corrective integration, before clean acceptance run

- Exporter browser regressions:4/4; raster/correction replay regressions:9/9. Explicit W5 newline and C2
  noncontiguous DOM ranges retain original pixels and all tolerances. Fixture preparation verifies7 immutable fixtures.
- Native unattached-hierarchy bounds correction:core/testing21 and feature/system40 tests pass, zero failures/errors/skips.
  Regression covers actual nested FrameLayout margins, ancestor scroll and TextView scroll/padding. Native notification
  and Glance host JSON now contains actual nonzero coordinates; attached AndroidView regression remains green.
  Log:`build/native-bounds-check.log`. This is native-host evidence, not emulator/SystemUI proof.
- Frozen submitted-letter viewer:letters46 tests plus lint pass; L1/L2 strict2/2, zero layout failures/bands,
  pixels0.10–0.16%. Exact version identity/account/server guards prevent live-draft fallback and writes.
- Fresh J5/W4/W5 strict3/3, zero layout failures/bands, pixels0.10–0.24%. Latest E selected report13/13 numeric,
  but J1's approved two-row stage preview source still requires recapture and independent review.
- Earlier callback batch exposed two compilation errors and one incorrect reopen-stage test expectation; these are
  being corrected before the full build. No aggregate or final-commit acceptance claimed from selected runs.

## 2026-11-08 — Independent corrections and final-run record

- Full first integration run executed886 tests with3 failures and no skips/errors; debug assembly passed. Lint found
  the API26 native-weight guard and configuration-aware string lookups. Those causes were fixed; subsequent assembly/lint passed.
- Root corrective run:designsystem73,career72,today18,documents60 passed. The remaining Apps test used a scroll action on
  a visible fit-content row; its corrected actual click then passed the focused1-test queued Delete/Undo-worker proof.
  No timeout, worker assertion, route target or tolerance was weakened.
- Real app callbacks:45/45 methods passed,238/238 physical links and211/211 approved pairs. Final unfiltered execution
  is bound to the final commit below; prior selected results alone do not establish it.
- Export feedback correction:share45 tests and lint passed; selected B11–B15/B19 fidelity6/6, zero layout failures/bands.
  Original diagnosis of a silent failure was corrected:feedback existed in root overlays; button/card state now owns it.
- Independent review covered all124 drawn composites and associated ends. New reviewer cleared copy-form24dp margins,
  shared frozen-letter footer, collapsed root-header width and Stories dark. Candidate aggregate remains57/62; only
  C2/C3/C5/C7 source departures and X1 native boundary fail strict comparison.
- Final clean command on the committed source:`./gradlew assembleDebug lint testDebugUnitTest fidelity --continue --max-workers=1`.
  Its actual source pin, start/end, exit statuses, full JUnit totals, dimensions and hashes are written to
  `build/final-evidence.json`; full output is `build/redesign-final-clean.log`. The strict fidelity exit remains nonzero
  for the five documented departures. The final corrective reviewer rehashes prior inventories and opens every changed PNG.
  Durable copy:`/Users/amruth/.codex/artifacts/android-redesign-final-20261108/`.
