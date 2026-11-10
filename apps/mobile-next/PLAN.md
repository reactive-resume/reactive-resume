# mobile-next: build plan

The new Reactive Resume phone app (Expo / React Native), built from the final storyboard (v4, 9 Nov 2026). The
specification is the handoff bundle at `/Users/amruth/Projects/reactive-resume/.agents/handoff/mobile-final`
(`BUILD.md` first). `apps/mobile` is a read-only reference.

## Decisions

| Topic           | Decision                                                                                                                                            | Why                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo SDK        | 58 (React Native 0.88.1, Reanimated 4.7.1, Gesture Handler 3.5, worklets 0.13.1)                                                                    | The repo's current SDK; the bundle's reference code is type-checked against exactly these                                                                                           |
| Stack navigator | `Stack` from `expo-router/js-stack` with `stackOptions()` from `src/ui/motion.tsx`                                                                  | Expo Router 58 vendors React Navigation and ships its own JS stack; the external `@react-navigation/stack` package no longer shares its contexts. Same JS stack, same interpolators |
| Docks           | `Tabs` from `expo-router/js-tabs` with the design-system `Dock` as `tabBar`                                                                         | Custom dock, fade-through owned by `FadeThroughProvider`                                                                                                                            |
| API client      | The typed oRPC client (`@orpc/client` + `@orpc/tanstack-query`, router types from `@reactive-resume/api`)                                           | BUILD.md §4: follow the repo's client where one exists. `apps/mobile/src/api/client.ts` already solves 401 handling and SSE with it                                                 |
| Server state    | TanStack Query; offline queue and drafts in `expo-sqlite`                                                                                           | As `apps/mobile/src/draft`                                                                                                                                                          |
| Preferences     | `expo-sqlite/kv-store`                                                                                                                              | Already in the dependency set; no MMKV                                                                                                                                              |
| Identifiers     | Production: `me.rxresu` (same as `apps/mobile`). Development: `me.rxresu.dev`. Storyboard: `me.rxresu.storyboard`. The scheme equals the identifier | BUILD.md §4; suffixed variants install beside the old app                                                                                                                           |
| Unit tests      | Jest (`jest-expo`) under `src/**/*.test.ts(x)`                                                                                                      | BUILD.md §4                                                                                                                                                                         |
| UI flows        | Maestro flows in `.maestro/`                                                                                                                        | BUILD.md §4                                                                                                                                                                         |
| Devices         | One simulator or emulator at a time, machine-wide                                                                                                   | The build machine's memory; captures are serialised through a lock (below)                                                                                                          |

## Structure

```
app/                     Expo Router routes; thin, they compose feature screens
src/ui/                  design system: tokens, motion, Text, Icon, components, Kit
src/features/<area>/     auth, today, documents, builder, letters, applications, workspace, career, settings, public, system
src/api/                 typed client, 401 handling
src/auth/                session, OAuth, server choice
src/data/                query client, persistence, offline queue, undo history, S7 approvals, fakes
src/render/              PageRenderer
src/i18n/                Lingui setup
src/dev/storyboard/      harness, scenarios, fixtures
scripts/                 check-motion.sh, icons codegen
```

## Route map

The tree in BUILD.md §5 is the map; deviations are recorded here as they are made.

| Route file                                                                                                                                                                                                                             | Screens                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `app/(auth)/welcome · server · sign-in · register · forgot-password · two-step`                                                                                                                                                        | A1, A2, A3                                                       |
| `app/(app)/(tabs)/index · documents/index · applications/index · career/index`                                                                                                                                                         | T1, T2, D1, J1–J3, C1                                            |
| `app/(app)/documents/[id]/actions` (sheet) · `new` (sheet) · `import` (modal) · `search` · `trash`                                                                                                                                     | D2, D3, D4, D5, D6                                               |
| `app/(app)/builder/[id]/(dock)/index · design · check · share`                                                                                                                                                                         | B1, B6, B9, B11                                                  |
| `app/(app)/builder/[id]/section/[section]/index · new · [item]/index · [item]/description · [item]/actions`                                                                                                                            | B2, B20, B3, B4, B21                                             |
| `app/(app)/builder/[id]/basics · design/template · design/layout · design/typography · design/page · check/job-match · share/web-page · share/activity · download · versions · assistant/index · assistant/proposals · preview · menu` | B5, B7, B8, pickers, B10, B12, B13, B14, B15, B16, B17, B18, B19 |
| `app/(app)/letter/[id]/(dock)/index · design · export`                                                                                                                                                                                 | L1, L2, Export                                                   |
| `app/(app)/applications/insights · new`                                                                                                                                                                                                | J4, J5                                                           |
| `app/(app)/applications/[id]/index · stage · interview · fit · apply · prepare · practise · messages · debrief · library`                                                                                                              | J6, J7 (+ J9 and "What did you send?" as steps), J8, W1–W5       |
| `app/(app)/career/coach/[[thread]] · knowledge/facts · knowledge/stories/index · knowledge/stories/[id] · knowledge/preferences · knowledge/priorities · offers · schedules/[id]`                                                      | C2–C7                                                            |
| `app/(app)/settings/index · account · preferences · profile · ai · ai/providers/[id]`                                                                                                                                                  | S1–S6                                                            |
| `app/(app)/ai/consent` (sheet) · S8 as a dialog over S1 · `app/(app)/consent`                                                                                                                                                          | S7, S8, A4                                                       |
| `app/r/[username]/[slug] · app/ats-checker`                                                                                                                                                                                            | P1, P2                                                           |
| `app/(dev)/storyboard/[id] · kit · motion-lab/[lab] · dev/haptics`                                                                                                                                                                     | harness, Kit, motion lab                                         |

## Ported from `apps/mobile` (logic only, never UI)

| What                                                                     | From                                | To                                     |
| ------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------- |
| OAuth 2.1 + PKCE, discovery, dynamic registration, single-flight refresh | `src/auth/session.ts`, `oauth.ts`   | `src/auth/`                            |
| Typed client, 401 recovery, SSE through `expo/fetch`                     | `src/api/client.ts`                 | `src/api/`                             |
| S7 approvals per account × connection × kind                             | `src/api/ai-consent.ts`             | `src/data/`                            |
| Offline draft queue, conflict handling                                   | `src/draft/`                        | `src/data/`                            |
| On-device page rendering                                                 | `src/preview/`, `modules/pdf-pages` | `src/render/`                          |
| Links, share target, identifiers                                         | `src/linking/`, `app.config.ts`     | `app.config.ts`, `src/features/system` |
| Translations                                                             | `locales/*.po`                      | `src/i18n/`                            |

## Ownership

| Owner              | Files                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead               | `src/ui/**` (review of every change), `app/_layout.tsx`, route layouts, `src/dev/storyboard/**`, `package.json`, `app.config.ts`, native builds |
| M (motion)         | `src/ui/motion*`, the interactive primitives in `src/ui`, `app/(dev)/motion-lab`, `scripts/check-motion.sh`, `.maestro/haptics`                 |
| P (platform, data) | `src/api`, `src/auth`, `src/data`, `src/render`, `src/i18n`, `modules/`                                                                         |
| A–F (screens)      | their routes and `src/features/<area>`; never `src/ui` or another agent's files                                                                 |

Merge order: foundation → navigation → screens A–F in parallel on disjoint folders in one checkout → fidelity rounds.

## Rules for every sub-agent

1. Work in `/Users/amruth/Projects/reactive-resume/apps/mobile-next` on branch `feat/mobile-next`. Never commit, stash,
   switch branches or run `pnpm install`; the lead does those. Never edit `apps/mobile`, the handoff bundle or files
   another agent owns. A missing component, motion primitive, data hook or dependency is a request to the lead in your
   report, never a local look-alike.
2. Node 24: prefix commands with `mise exec node@24 --`. Typecheck: `mise exec node@24 -- pnpm typecheck` in the app
   folder. It must pass before you report.
3. Tokens only (`src/ui/tokens.ts`): no hex colours, font names, durations or curves outside `src/ui`. Text goes
   through `Text`, icons through `Icon`, touches through `Touchable` or a design-system control.
4. One simulator or emulator runs at a time on this machine. Before any `xcrun simctl`, `adb`, `rn_capture.mjs` or
   emulator use, take the lock `mkdir /tmp/rr-device.lock` (retry every 20 s while it exists), and `rmdir` it as soon
   as your capture finishes. Hold it for minutes, not for a whole task. The lock file `owner` inside says who has it.
   Metro for the storyboard variant runs on port 8081 from the lead's shell; reuse it, never start a second one.
5. Repo rules (`/Users/amruth/Projects/reactive-resume/CLAUDE.md`): no AI attribution, no credentials or personal
   data in source, user-facing strings through Lingui macros with copy from the web app and `GLOSSARY.md`.
6. Use current documentation (the `ctx7` CLI: `npx ctx7@latest library <name> "<question>"` then
   `npx ctx7@latest docs <id> "<question>"`) before writing against Expo, Expo Router, Reanimated, Gesture Handler,
   keyboard-controller or any other library.

## Data model and API mapping

Platform/data owner exposes hooks from `src/data/index.ts`. Mount `DataProvider({ backend?: "real" | "fake", children })`
inside the auth/i18n shell; default follows `EXPO_PUBLIC_STORYBOARD`. `seed("storyboard" | "empty-account")` changes the
same backend used by hooks, draft adapters and lifecycle actions; `isBusy()` reports fixture requests. Fixture strings
are extracted verbatim into `src/data/storyboard-texts.json`; `screenTexts(screenId)` exposes the complete screen copy.

Resource hook results are TanStack `UseQueryResult<RouterOutput[...]>` unless stated otherwise. Optional inputs retain
the router's input type; IDs below are strings. `useDataActions().write(kind, operation, input)` persists supported
non-document edits before sending; `.flush()` retries. Resume/letter editing uses the existing draft engine, not direct
query mutations: mount `useResumeDraftOwner(id)` / `useLetterDraftOwner(id)` once per document layout, then read
`useResumeStore(selector)` / `useLetterStore(selector)` in panes. Wire focus/blur through `resumeFieldFocus` /
`letterFieldFocus`; keep the same owner across builder panes. Draft store actions include update, undo/redo, flush,
retry and resolveConflict; `conflict` is data for the screen-owned presenter. `useDocumentHistory(id)` owns explicit
screen action steps (`record({ undo, redo })`, canUndo/canRedo, undo/redo); mount once per document visit.

| Hook / action                                                                                                                                            | Screens                                              | Existing router / owner                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `useSession()`, `signIn(server?)`, `signOut({discard?}?)`, `chooseServer(url)`, `continueAsGuest()`                                                      | A1–A3, S1, S8                                        | SecureStore OAuth/PKCE; server health + flags; local-only guest documents             |
| `useDocuments(filters?)`                                                                                                                                 | D1–D4, B19, J5                                       | documents.list                                                                        |
| `useResume(id)`, `useResumeStore(selector)`, `useResumeDraftOwner(id)`                                                                                   | B1–B21                                               | resume.getById; shared durable draft engine                                           |
| `useLetter(id)`, `useLetterStore(selector)`, `useLetterDraftOwner(id)`                                                                                   | L1–L2, letter Export                                 | coverLetters.getById; shared durable draft engine                                     |
| `useApplications(filters?)`, `useApplication(id)`                                                                                                        | J1–J9                                                | applications.list / getById                                                           |
| `useApplicationWorkspace(applicationId)`                                                                                                                 | W1–W5, Debrief, Library                              | career.workspace                                                                      |
| `useCareerFacts(scope?)`                                                                                                                                 | C1, C3, B4, B10, W1                                  | career.facts                                                                          |
| `useCareerStories(scope?)`                                                                                                                               | C1, C4, W3                                           | career.stories                                                                        |
| `useCareerPreferences()`                                                                                                                                 | C1, C5–C6                                            | career.profile                                                                        |
| `useCareerOffers(filters?)`                                                                                                                              | C6                                                   | career.savedItems (kind: offer)                                                       |
| `useCareerSchedules()`                                                                                                                                   | C1, C5, C7, J8, W3                                   | career.schedules                                                                      |
| `useSettings()`                                                                                                                                          | S1, S3                                               | account-scoped SQLite preferences; save(partial)                                      |
| `useAccount()`, `useProfile()`                                                                                                                           | S2, S4                                               | auth.getProfile / applicationProfile.get                                              |
| `useAIProviders()`                                                                                                                                       | S5–S7, every AI connection chip                      | aiProviders.list                                                                      |
| `useNotifications()`, `useToday()`                                                                                                                       | T1–T2, X1                                            | career.notifications / opportunities + applications.list                              |
| `useSearch(query)`                                                                                                                                       | D5                                                   | documents.list + application filtering                                                |
| `useTrash()`                                                                                                                                             | D6                                                   | documents.list (trashed) + applications.listTrash                                     |
| `usePublicResume({username,slug})`                                                                                                                       | P1                                                   | resume.getBySlug (public; no account required)                                        |
| `useATSCheck(data?)`, `usePDFATSCheck()`                                                                                                                 | B9, P2                                               | @reactive-resume/resume/ats local lint; clock injected                                |
| `useResumeVersions(id)`, `useLetterVersions(id)`                                                                                                         | B15, letter history                                  | resume.listVersions / coverLetters.listVersions                                       |
| `useQueuedWrites()`, `usePendingChanges()`, `pendingCounts()`, `saveQueuedBundle()`, `exportQueued()`, `restoreQueued(bundle)`                           | S8, D4                                               | account-scoped SQLite queue + validated draft records                                 |
| `moveToTrash(ref)`, `restore(ref)`, `deletePermanently(ref)`, `emptyDocumentTrash()`, `emptyApplicationTrash()`                                          | D2, D6, J6                                           | documents lifecycle; applications lifecycle carries exact trashedAt                   |
| `closeApplication(id,reason,note?)`, `reopenApplication(id,status?)`                                                                                     | J7, J9                                               | applications.update; stage date from clock                                            |
| `sentCandidates(applicationId)`, `markApplied(applicationId,{resumeVersion,letterVersion})`                                                              | J5, J7, J1/J2 moves, W2                              | applications.update transitions to Applied and creates immutable sent versions        |
| `ensureApproved(kind,connection)`, `setConsentPresenter(fn)`                                                                                             | S7, all AI sends                                     | per account/connection/kind SQLite approvals; typed destination headers retained      |
| `approveRecurring(connection)`, `recordRecurringApproval(id,connection)`, `recurringWorkStatus(id,connection)`, `saveApprovedSchedule(input,connection)` | C5, C7, J8, W3                                       | persisted local approval + career.saveSchedule                                        |
| `pageRenderer.render({kind,id,revision,data?,fixture?,public?})`                                                                                         | B1, B6, B15, B18, D1, L1–L2, P1                      | native Forme/PDF + copied pdf-pages module; account/revision files; last good offline |
| `now()`, `timeZone()`, `setNow(value?)`, `setTimeZone(zone?)`, `wallTimeChoices(date,time,zone?)`                                                        | all date-dependent screens; J8 repeated-hour choice  | Intl + deterministic fixture clock                                                    |
| `parseDeepLink(url,server)`, `redirectSystemPath({path,initial})`, `setLinkPresenter(fn)`                                                                | cold/warm links, public links, builder, applications | validated raw path; system browser fallback; UI owns confirmation                     |

`SentVersion` is `{id:string, revision:string|number}` (resume updatedAt ISO string, letter numeric revision), or null
for an unchecked document. `rememberLinkedDocuments(applicationId, selection)` saves a local link baseline after a
successful link. Legacy/server-created links without a baseline are marked changed and require explicit selection.
Current server freezes current revisions; atomic expected-document-revision support is still needed to close the
read→submission race. Interview details already carry an IANA timezone; schedules already carry timezone and prepare
jobs already pin provider revisions. Client recurring approval exposes paused when its approved connection changes.

Lead integration: call restoreSession/initI18n before the shell; register consent/link presenters; mount DataProvider;
route native intents to redirectSystemPath; import polyfills from index before modules. Local module auto-linking must
scan `modules/pdf-pages`, and native builds must include Forme. Metro/Babel already support Lingui catalogs/macros.
S8 uses saveQueuedBundle (system folder picker plus completed JSON write). Share-sheet dismissal via
shareQueuedBundle is not proof of a Files save and never grants permission to discard. Native/device and real-server sign-in
verification remain separate from host tests.

For field-level undo in the ported draft engine, use a focus-visit coalesce key with `sameStep: true`; use `newStep`
for discrete actions. Do not mount multiple draft/history owners in sibling panes. Scheduled discovery currently uses
the server web-search connection (not AI); the C7 Work OpenAI fixture label must not misdescribe live server behavior.
Provider updates already pause bound schedules and cancel queued/running jobs in ai-providers/service.ts; no duplicate
server implementation is needed for that path. Remaining server contract gaps are atomic expected document revisions
at submission, durable link baselines across devices, a cover-letter PDF endpoint for fallback, and atomic close+note
if that guarantee is required (current client logs the note separately and reports partial failure).

For signed-out P1, supply the redacted getBySlug data and `public: true` to pageRenderer.render. Public cache ownership
is bound to the server, and an account/server change invalidates an in-flight result. Private rendering still requires
an account. The public/letter paths do not invent a protected server PDF fallback when no matching endpoint exists.

## Screen agent guide

Screen agents (A–F) each work in their own git worktree and commit there; the lead merges. This section replaces rule 1's
"never commit" and rule 4's Metro note for them; everything else in "Rules for every sub-agent" holds.

**Setup (once).** In your worktree's `apps/mobile-next`: if `node_modules` is missing run
`mise exec node@24 -- pnpm install --offline --frozen-lockfile` from the repo root of the worktree. Start your own Metro
on your port: `APP_VARIANT=storyboard EXPO_PUBLIC_STORYBOARD=1 mise exec node@24 -- npx expo start --dev-client --port <port> > build/metro.log 2>&1 &`
(create `build/` first; it is git-ignored). Ports: A 8082, B 8083, C 8084, D 8085, E 8086, F 8087. Stop it when you finish.

**What to build with.**

- `src/ui/index.ts` exports every component, scaffold and motion primitive; read `src/ui/scaffold.tsx` first. Root tabs
  use `TabScreen`; pushed screens and full-screen modals use `PushScreen` (`back="close"` for modals, `docked` for builder
  and letter modes, `footer`, `barEnd`, `status` for the document status line with Undo · Redo); sheets use `SheetScreen`
  with the `height` from the screen's `BottomSheet` box in its layout dump; dialogs use `Dialog`. Rows are `ListRow`,
  headings `SectionHeading`, and so on, as named by `component` in the layout dumps and in `design/COMPONENTS.md`.
- Data: only the hooks exported from `src/data/index.ts` (table above). In storyboard captures they return the fakes,
  seeded with the storyboard's data; `screenTexts("<ID>")` lists a screen's exact strings. If the fake lacks something
  a screen draws, add a typed view-model in your feature folder that derives it from the hooks, and report the gap.
- Strings: Lingui macros (`t` from `@lingui/core/macro`, `Trans` from `@lingui/react/macro`), copy exactly as the layout
  dump has it (· – ’ included). Never run `lingui extract`; the lead does.
- Navigation: `useRouter()` from `expo-router`; every `navigatesTo` in your dumps must work. Route files and their
  presentation (push, modal, sheet, hero) already exist in `app/`; replace the placeholder body, keep the file path.
  Layout files (`_layout.tsx`) belong to the lead.
- Scenarios: add yours to `src/dev/storyboard/scenarios/<your letter>.ts` (hrefs to replay so the real stack, sheets and
  docks are on screen, fixture, `prepare`).
- Never edit `src/ui`, `src/data`, `src/api`, `src/auth`, `src/render`, layouts, `package.json` or another agent's
  folder. A missing component, variant, prop, motion primitive or data hook goes in your report as an exact request
  (name, props, measurements from the dump); until the lead adds it, leave that element out rather than drawing a
  local look-alike. Tokens only: no hex colours, font names, durations or curves in your files.

**Capture and measure (iOS; the lead runs Android).** One simulator serves everyone: take the lock
(`mkdir /tmp/rr-device.lock && echo <letter> > /tmp/rr-device.lock/owner`; retry every 20 s while it exists), then:

```sh
U=CD4BE437-2AEC-4FB8-8CB6-5D00E08188AE
B=/Users/amruth/Projects/reactive-resume/.agents/handoff/mobile-final
xcrun simctl terminate $U me.rxresu.storyboard
xcrun simctl openurl $U "me.rxresu.storyboard://expo-development-client/?url=http%3A%2F%2Flocalhost%3A<port>"
sleep 30   # first bundle; check build/metro.log for "Bundled"
node $B/tools/rn_capture.mjs screens --platform ios --scheme me.rxresu.storyboard --bundle-id me.rxresu.storyboard \
  --udid $U --warm --only <ID,ID,…> --out build/fidelity/ios
rmdir /tmp/rr-device.lock 2>/dev/null || rm -rf /tmp/rr-device.lock
python3 $B/tools/fidelity.py build/fidelity/ios build/fidelity-report/ios --only <ID,ID,…> --system-bars
```

Release the lock right after the capture and before analysing; batch your screens into one capture run; never hold it
longer than five minutes. Read `build/fidelity-report/ios/<ID>-layout.txt` and open `<ID>-light-compare.png` and
`<ID>-dark-compare.png` (storyboard | app | difference). Fix causes, never the tools, dumps, baselines or tolerances.
A screen passes with 0 layout failures, at most 3.0% differing pixels in each theme and no solid band. The debug build
draws a floating gear button at the top end; differences from it alone are expected until the lead's Release run, so
say so in your report instead of working around it.

**Finish.** `mise exec node@24 -- pnpm typecheck`, `mise exec node@24 -- pnpm test` and `sh scripts/check-motion.sh`
(prints nothing) pass; `mise exec node@24 -- pnpm exec vp lint --fix <your paths>` and `pnpm exec vp fmt <your paths>`
from the worktree's repo root. Commit your work in your worktree with a Conventional Commit message
(`feat(mobile-next): …`, no AI attribution, no trailers). Report: your branch name and commit; one scoreboard line per
screen; each remaining difference with its cause; every request to the lead; behaviour bullets from `SCREENS.md` you
did not implement and why; questions about direction.
