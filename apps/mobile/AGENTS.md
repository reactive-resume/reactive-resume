# Mobile app (`apps/mobile`)

Expo / React Native app. The root `AGENTS.md` still applies; this guide covers mobile-only workflows.

## Tests

Mobile tests are host tests, not Vitest: `scripts/*.test.mjs` run under `node --test` on Node 24. They need no simulator, emulator or Metro.

```sh
pnpm --filter mobile test                     # every file
pnpm --filter mobile test:ci                  # same run, plus JUnit at apps/mobile/reports/node-junit.xml
node --test apps/mobile/scripts/layout.test.mjs                               # one file
node --test --test-name-pattern "Undo" apps/mobile/scripts/career-undo.test.mjs # matching cases
```

CI's unit job runs `test:ci` through Turbo, so a failing mobile test fails the pull request.

Tests never import app source directly. `scripts/harness.mjs` compiles one source file with esbuild and runs it against a mock map:

- `load(path, mocks, { globals, append, ...esbuildOptions })` compiles one file. `path` is relative to `scripts/` (`"../src/…"`). `globals` become free variables (`React`, `__DEV__`, `setTimeout`).
- `bundle(path, mocks, options)` also bundles the relative imports the file reaches; only `mocks` keys stay external.
- `run(code, mocks, globals)` evaluates already-compiled CommonJS. `tag` stands in for Lingui `t`. `mobileRequire` loads real packages from the app's dependencies. `esbuild` is the compiler.

`AssertionError: Missing boundary: X` means the file under test imports `X` and the test's mock map has no key for it. Most files keep a shared map near the top (`mocks`, `dependencies`, `common`, `defaults`) that their local `load` merges with per-call `extra`. Add the stub there:

```js
"@/ui/new-thing": { NewThing: "NewThing" }, // component: render as a string tag
"expo-haptics": { impactAsync: async () => {} }, // native module: no-op
immer: mobileRequire("immer"), // pure library: real module
```

When a source file gains an import, grep `scripts/` for its path (for example `features/write/dates`) to find every test that loads it; each one needs the stub. A few files keep their own loader because their setup differs (real-module fallback, `.po` handling, source-string mocks); edit those in place.

### `experience.test.mjs`

About 5,000 lines, written as one script rather than separate `test()` cases. The first failing assertion stops the rest.

- Lines 1–190 hold the shared setup: a fake `react` whose hooks are keyed by call order, `ui` and `mocks` (the shared boundary map), and `load(path, extra, append)` with `path` relative to `src/`.
- Helpers: `render(Component, props)` calls the component and returns its element tree. `nodes(tree)` flattens it. `control(tree, label)` returns the props of the element with that `label`, or fails. `reset()` clears hook state and the `calls` log. `settle()` flushes pending promises.
- Each case ends with `console.log("PASS …")`. Find a case by grepping its PASS line or the source path it loads (`load("features/…`).

### Adding cases

Put tests for a new feature in a new `scripts/<feature>.test.mjs` that uses `test()` from `node:test` and the harness. Extend `experience.test.mjs` only when a case needs its fake React and shared mocks: add the block beside related cases, start it with `reset()`, and end it with `console.log("PASS …")`.

- Test logic from `packages/*` in that package. Mobile tests cover the mobile call site: account fences, drafts, Undo and routes.
- Don't copy app modules into mocks; copies drift. `src/routes.ts` has only type imports, so load the real one.
- Drive debounces and delays with a fake `setTimeout` passed through `globals`, or with `mock.timers`. Never wait real time.

## Bundle check

```sh
pnpm --filter mobile check:bundle
```

This runs `expo export` for iOS and Android: Metro bundles the whole app and compiles Hermes bytecode. It uses a fresh Metro cache in a temporary directory and deletes it afterwards, so it needs no `TMPDIR` or `--clear` flags and leaves nothing in the checkout. It takes about 1.5 minutes on an Apple-silicon Mac.

Run it after changing imports, dependencies, Babel or Metro config, or shared-package code the app reaches, and before handing off mobile work. CI runs it when `apps/mobile/` or `packages/` changes.

## Where web features live on mobile

Names differ between the apps; start from this map instead of guessing paths.

| Web (`apps/web/src/…`)                                                        | Mobile (`apps/mobile/…`)                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `routes/builder/$resumeId`, `features/resume`                                 | `app/builder/[id]`, `src/features/{write,design,check,share,history,document-menu}`                                               |
| `routes/builder/letter`, `features/letters`                                   | `app/letter/[id]`, `src/features/letters`                                                                                         |
| `routes/dashboard/applications`, `features/applications`                      | `app/(tabs)/applications`, `app/applications/[id]`, `src/features/{applications,applications-board,application-detail,reminders}` |
| `routes/dashboard/career`, `features/career` (incl. `workspace`, `knowledge`) | `app/(tabs)/career`, `src/features/{career,workspace}`                                                                            |
| `routes/agent`, `features/assistant`                                          | `app/builder/[id]/assistant.tsx`, `src/features/assistant`                                                                        |
| `routes/dashboard/resumes`, `features/documents`                              | `app/(tabs)/documents`, `src/features/documents`                                                                                  |
| `routes/dashboard/settings`, `features/settings`                              | `app/(tabs)/settings`, `src/features/settings`                                                                                    |
| `apps/web/src/routes/_home/ats-checker.tsx`, `features/ats-checker`           | `app/ats-checker.tsx`, `src/features/ats-checker`                                                                                 |
| `features/command-palette`                                                    | `app/search.tsx`, `src/features/search`                                                                                           |
| `features/keyboard-shortcuts`                                                 | `src/shell/key-commands.ts`, `src/shell/shortcut-help.tsx`                                                                        |
| `routes/auth`, `features/auth`                                                | `app/(auth)`, `src/auth`                                                                                                          |
| Public resume page (server: `apps/server/src/static/resume-page.ts`)          | `app/r/[username]/[slug].tsx`                                                                                                     |
| `packages/ui` primitives                                                      | `src/ui` (tokens in `src/ui/tokens.ts`)                                                                                           |

## OTA update or store build

The runtime version is an Expo fingerprint (`fingerprint.config.js`). JavaScript, styling, copy, translations and
bundled assets ship as an OTA update with the next stable release. Native dependencies or config plugins, permissions,
`app.config.ts` native fields, Expo SDK upgrades, `patches/`, and Forme native sources or
`packages/forme-native/scripts/prebuilt.json` need a new store build. Say which one a change needs in its PR. Release
steps: `.agents/docs/runbooks/mobile-releases.md`; workflow and signing setup: `.agents/docs/runbooks/mobile-ci.md`.

## Parity exceptions

The owner's explicit decisions; every other web/mobile gap is a bug. Add new exceptions here with the date.

- iOS hides the Donate row (store policy, first release).
- Applications CSV export is web-only (2026-10-19). CSV import shipped on mobile in RX-183.
- Employer-form autofill and the embedded browser are not on Android or iOS (2026-11-01, RX-75). Mobile keeps review
  packets, copyable answers, exact approved PDFs and opening the form in the system browser.
