# Android storyboard v2.1 redesign report

Branch: `feat/android-redesign-v2`. All 62 drawn screens are implemented. No push or pull request.
Strict acceptance is **57/62**, with four source-aligned departures and one native-system boundary described below.
This is not a claim of 62/62 strict acceptance. The emulator smoke gate remains unmet.

## Structural changes

- Shared v2.1 typography, exact text line boxes, softer radii, rows, fields, cards and one shared tab dock.
- Field-first builder with Edit / Design / Check / Share, pushed Typography and Page pickers, and kind-aware B19 menus.
- B18 full-screen preview; Assistant and Proposals are full-screen; editing/export sheets retain their proper boundaries.
- J6 overview has seven Work on it rows pushing Fit, Apply, Prepare, Practice, Messages, Debrief and Library.
- J1 uses two-row stage previews, truthful totals and accessible heading expansion; all stored applications and Closed remain available.
- Import uses the shared local PDF/JSON/LinkedIn reader in an isolated app-assets WebView. Submitted letters use a separate read-only version owner, never a live-draft fallback.
- Copy-for-job keeps the source document and application identity. Local interview reminder receipts are scoped to account, server, device and exact event; the delivery guard spans Delete's queued Undo window.
- Export progress, failure and retry now belong to the Share PDF card/button, using the existing export owner.

## Final score and evidence

The unchanged strict report is [build/fidelity-report/FIDELITY.md](build/fidelity-report/FIDELITY.md).
The final source pin, command/exit status, JUnit totals, 124 primary frame dimensions, immutable-input checks and artifact hashes
are recorded in [build/final-evidence.json](build/final-evidence.json). Evidence is also preserved outside build output at
`/Users/amruth/.codex/artifacts/android-redesign-final-20261108/`.

| Category                                                                                                       | Strict result                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Auth/settings, Today/documents/search, builder/share/Assistant/letters, applications/workspace, C1/C4/C6/P1/P2 | 57 passing screens in both themes                                                             |
| C2 Coach                                                                                                       | 5 raw layout failures: unknown historical application count and dependent chip width/position |
| C3 Facts                                                                                                       | 2: unavailable source actor/date                                                              |
| C5 Preferences                                                                                                 | 2: actual priorities/search regions replace unsupported Avoid/site-count fields               |
| C7 Schedule                                                                                                    | 2: actual interval/enabled controls replace unsupported weekday/push fields                   |
| X1 native system                                                                                               | 31: native notification, widget and launcher hierarchy is proved separately                   |

All 62 screens meet the 3% pixel gate in both themes, with zero solid difference bands. The fidelity task deliberately
retains a failing exit status for these five screens. No tolerance, test target or failure was removed to obtain green.

## Owner decisions and measurement custody

Amruth chose the following resolutions during this work:

| Contradiction                               | Resolution                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Builder More links disagree                 | Every ellipsis opens B19 Document menu; B18 remains Page preview.                                                              |
| Typography/Page sheet versus pushed screen  | Use pushed pickers.                                                                                                            |
| Scaled page text has unscaled derived boxes | Correct the exporter and regenerate affected measurements; preserve PNGs and tolerances.                                       |
| Raster internals have no native text nodes  | Verify exact decoded RGBA hash, dimensions and real image bounds; measure every actual Compose element normally.               |
| C2 combines paragraphs around a list        | Export each real noncontiguous DOM text range separately.                                                                      |
| W5 concatenates text around an HTML br      | Preserve the real line break.                                                                                                  |
| C3/C5/C7 require absent source fields       | Record truthful source-aligned departures instead of inventing domain data. C2's historical application count is also unknown. |
| X1 draws OS/launcher chrome                 | Separate native system proof from ordinary Compose acceptance.                                                                 |
| J1 draws two rows but counts four           | Two-row stage previews with truthful totals and heading access to the full group.                                              |

Geometry remains 1 dp; glyph-width tolerance remains 4 dp; pixel and band gates remain 3% and 25%.
All 127 original storyboard/board PNG hashes match the survey snapshot. Seven packaged raster fixtures are byte-identical
to the supplied assets. No invisible page text or marker nodes were invented. Visible preview marker overlays are measured
as actual Compose elements.

`tooling/android/export-scaled-layout.mjs` uses supplied fonts and real DOM ranges. `prepare-fidelity.py` guards/replays
approved corrections and exact raster evidence. Four browser exporter regressions and nine raster/replay regressions pass.
Native TextView dumps use actual layout/paint data and hierarchy coordinates, including unattached hosts and scrolling.
An API-26 regression prevents inventing an unavailable numeric typeface weight. Compose's supported test environment owns
the frame clock; the wrong-clock mutant is detected by the retained capture regressions.

## Validation and independent review

Run from `apps/android`, with JDK 21 and the configured Android SDK:

```sh
./gradlew assembleDebug lint testDebugUnitTest
./gradlew fidelity
```

Use Android Studio's `app` run configuration on an available emulator/device. Debug APK:
`app/build/outputs/apk/debug/app-debug.apk`. The fidelity task cleans actual captures, reruns screenshot tests and invokes
the unchanged strict scoreboard. Its nonzero result for the five documented departures is intentional and remains visible.
The final combined execution and all executed/skipped/failing test totals are in `build/final-evidence.json` and the final log.

The real app callback matrix covers 238 physical links and 211 approved route pairs (210 raw pairs before owner-approved
navigation corrections). It is generated from the actual app NavHost/callback tests with fake repositories at the boundary;
graph registration alone is not counted as callback proof. The real queued Delete/Undo regression runs the reminder worker,
proves no delivery during the queue/Undo window, preserves the exact receipt on Undo, then allows delivery afterward.

Fresh visual reviewers inspected all 124 primary composites, associated scroll-end captures, Kit and supplementary states.
They found defects that passed numerical thresholds: copy-form margins, frozen-letter footer and collapsed-header double
padding. A new reviewer checked those fixes and the new Stories dark capture. Final custody is established by hash equality
against the complete earlier inventories and by reopening every changed image after the clean final-commit run.
See [REVIEW.md](REVIEW.md) and these durable reports:

- `/Users/amruth/.codex/artifacts/android-final-review-abcd.md`
- `/Users/amruth/.codex/artifacts/android-final-review-ef.md`
- `/Users/amruth/.codex/artifacts/android-final-corrective-review.md`

Kit matches at SHA256 `cb786164b1ddfbb8b65396f50e16d1a69a3557a67987d5fb624b1f34ecbb1329` (0.11% pixels, zero solid bands).

## Undrawn screens designed from shared patterns

No exact baseline was invented for an undrawn state. Representative theme-paired captures:

| Pattern                                              | Screenshots under build/fidelity                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section entry types, Summary and rich editing        | `B3-Education-light.png`, `B3-Education-dark.png`, `B4-Summary-light.png`, `B4-Summary-dark.png`; other B3 entry types are captured too                  |
| Pushed Typography/Page and other design pickers      | `B6-Typography-light.png`, `B6-Typography-dark.png`, `B6-Page-light.png`, `B6-Page-dark.png`                                                             |
| Copy-for-job form                                    | `D2-Actions-copy-light.png`, `D2-Actions-copy-dark.png`, plus both end captures; D3 reuses the same form, without a separate independent variant capture |
| Frozen submitted letter                              | `L1-LetterSnapshot-light.png`, `L1-LetterSnapshot-dark.png`, plus both ends                                                                              |
| Letter signature/design/menu/version/export variants | `L1-*`, `L2-*`, `B19-Notes-*` and corresponding variant captures; unsupported signature/print modes remain explicit gaps                                 |
| Stories list                                         | `C3-Stories-light.png`, `C3-Stories-dark.png`                                                                                                            |
| Debrief and Library                                  | `W5-Debrief-light.png`, `W5-Debrief-dark.png`, `W5-Library-light.png`, `W5-Library-dark.png`, plus available ends/empty state                            |
| Offer comparisons and public password states         | `C6-Offers-*`, `P1-*`, `P2-*`                                                                                                                            |

The evidence inventory records exact files and hashes. Some fit-content lists do not overflow and therefore have no end capture.

## Behavior gaps and limits

The per-screen Interactions/Haptics/Motion/States matrix is
`/Users/amruth/.codex/artifacts/android-final-behavior-audit.md`. It distinguishes implemented source paths, tested runtime
behavior, confirmed gaps and unverified behavior. Screenshot fidelity does not establish all behavior bullets.
Material remaining gaps include:

- Frozen resume/letter PDF transport, immutable submitted-answer retrieval, company-brief provenance, private per-template personal previews and real candidate page-fit measurement are absent from current contracts. No live document is passed off as a frozen artifact.
- Phone-local ATS, drawn/image letter signatures, letter Print/Notes/Tags and atomic new-job letter copying remain unsupported.
- Some specified motion/interaction details remain absent or unverified: builder band/shared-element transitions, snapping/folding/automatic focus scrolling, IME Next behavior, letter selection/dock transitions and per-change Undo presentation.
- B16 direct camera capture, W3 scheduled-refresh controls, W5 post-Copy/Mail follow-up offers/in-place editing and Debrief offer-term parsing are recorded gaps. Other copy/behavior departures are mapped in the audit.
- Native share/SAF/print/camera/microphone delivery, haptic feel, timing, TalkBack, real WebView parsing and live backend behavior remain device/server-unverified.

X1 evidence under `build/fidelity/native-system` contains actual Notification objects/channels/actions, immutable
PendingIntents, ShortcutManager entries and measured Glance Views. Medium widget host is 358×200 dp versus the board's
358×142 dp, retaining 44 dp row targets; small host is 150×150 dp. Notification content is measured in a 358×252 dp host;
SystemUI owns its eventual outer frame. Bounded 200% host captures truncate some content and do not establish device
accessibility. These explicit native differences are not strict Compose pixel acceptance.

## Device gate and remaining direction

Emulator install was refused with `DEVICE_IN_USE`, owned by another workspace. The tool's diagnostic advice did not
resolve access. That session was neither reused nor closed. No emulator smoke screenshots, default/200%/RTL device
acceptance, TalkBack or real WebView runtime acceptance are claimed. Host captures remain separate evidence.
There are no unanswered direction questions. Exact 62/62 strict acceptance and the device gate remain unmet as recorded.
