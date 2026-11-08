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
