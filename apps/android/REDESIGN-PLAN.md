# Android storyboard v2.1 redesign

Specification: `/Users/amruth/Projects/reactive-resume/.agents/handoff/android-app`.
Starting commit: `ade5fa027e3fc7aeddea7a842c755e48c09cef67` (`main`).
Working branch: `feat/android-redesign-v2`. No push or pull request.

## Contract and evidence

The measured layout JSON wins for geometry, screenshots for appearance, source HTML/CSS for structure,
COMPONENTS.md for shared components, and SCREENS.md for behavior. Geometry tolerance remains 1 dp;
text width tolerance remains 4 dp. Both themes must satisfy the supplied fidelity tool unchanged.
App screenshots and layout JSON must come from rendered Compose; no copying reference outputs.
Every fidelity run requires composite inspection and a log entry. A passing regression screenshot alone
does not prove storyboard fidelity. Final acceptance requires 62/62, independent review, behavior tests,
Kit comparison, and default/200%/RTL emulator smoke.

## Survey

- Existing app has 976 tracked files, real/fake repositories, shared design system, typed navigation,
  Robolectric/Roborazzi tests and informational storyboard pixel reports.
- Existing tokens, rows, headers, mode bars, builder entry dialog, application workspace tabs and
  screenshot names follow v1. Nine v2 screenshot stems have no exact current capture name.
- Shared text wrapper already handles Android font extents; preserve it and prove the v2 line boxes.
- No structured layout dumps or strict fidelity task exist. Add instrumentation at shared components.
- Current fake page renderers draw older PDF fixtures; use the supplied page/photo/template PNG fixtures.
- Fixture data differs in resume design, application contacts/dates, check counts and locked document.
- Navigation inventory: 62 board IDs, 238 link occurrences, 210 unique source-target pairs.
- Remove mode/underline tabs and outline/entry-sheet routes only after all callers migrate.
- Toolchain: JDK 21 available (default JDK 27), Android SDK installed, Gradle wrapper works;
  initial existing text/haptics test passed. Python 3 + Pillow 13 installed. Pixel emulators available.

## Ownership and merge order

1. Lead: core tokens/text/icons/insets/instrumentation, core testing, build task, shared fakes/page fixtures.
   Supervised foundation worker: core design-system components and Kit. No feature edits in this pass.
2. Lead: core navigation and app root docks; coordinate feature graph changes with feature owners.
3. Feature workers, each isolated by module and preferably a prepared worktree:

| Worker | Screens                                        | Owned modules                                     |
| ------ | ---------------------------------------------- | ------------------------------------------------- |
| A      | A1–A4, S1–S6                                   | feature/auth, feature/settings                    |
| B      | T1–T2, D1–D6                                   | feature/today, feature/documents, feature/search  |
| C      | B1–B10, section/entry editors, Typography/Page | feature/builder                                   |
| D      | B11–B19, L1–L2, letter export                  | feature/share, feature/assistant, feature/letters |
| E      | J1–J8, W1–W5, Debrief/Library                  | feature/applications, feature/workspace           |
| F      | C1–C7, P1–P2, X1, Stories list                 | feature/career, feature/public, feature/system    |

Integrate A/B/F, then C/D (builder slots), then E (workspace routes). Shared core changes always go
through lead. Rebase integrations on current foundation; preserve real repositories and existing safeguards.
Independent reviewers must have written none of the UI under review.

## Self-contained feature brief contract

Each issued brief includes the absolute bundle path above, exact screen IDs/stems, owned files/modules,
available shared components and stateless state/callback/repository contracts, and the fidelity contract.
Read local AGENTS.md, REDESIGN.md, COMPONENTS.md, screens/dumps/source and SCREENS.md before edits.
Never edit another worker's module or core; request missing shared components from lead.
Use JDK 21 and existing static fonts/Phosphor drawables. Fetch current API docs via Context7.
Keep real repositories; exact storyboard seeds and image fixtures belong to fakes.
Run from the worker's `apps/android`:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew :feature:AREA:testDebugUnitTest
python3 /Users/amruth/Projects/reactive-resume/.agents/handoff/android-app/tools/fidelity.py build/fidelity build/fidelity-report --only EXACT,SCREEN,STEMS
```

Use the shared capture helper to generate both PNG themes and measured JSON. Inspect every light/dark
composite, fix causes, repeat. Capture offscreen elements after scrolling. Report scoreboard lines,
commands/results, changed files, unresolved differences with coordinates, behavior gaps and direction conflicts.
Never change baseline images/layout dumps, raise tolerance, skip assertions or replace actual output with references.

## Passes and gates

0. Survey/plan; 1. foundation + metrics + Kit + harness; 2. navigation + edge tests;
1. parallel screen rebuild; 4. full measure/fix loops to 62/62; 5. independent visual review;
2. fix/re-measure/re-review until no findings; 7. behavior verification; 8. emulator smoke.
   Commit each complete pass, then final report and clean final-commit fidelity run.

## Direction questions

One bundled question sent: ellipsis edges inconsistently point to B18 preview versus B19 menu;
Typography/Page described as both sheets and pushed pickers. These dependent edges await the owner's answer.
