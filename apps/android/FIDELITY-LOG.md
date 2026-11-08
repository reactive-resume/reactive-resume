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
