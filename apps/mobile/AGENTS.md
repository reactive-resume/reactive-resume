# Mobile app (`apps/mobile`)

The Reactive Resume phone app for iOS and Android: Expo SDK 58, React Native 0.88, Expo Router. Production installs
as `me.rxresu`, the same identifiers as the first Expo app it replaced. The root `AGENTS.md` still applies; this guide
covers mobile-only work. `PLAN.md` holds the build decisions, route map and data hooks; `REVIEW.md`, `FIDELITY-LOG.md`
and the `MOTION-*.md` files are the build's review records.

## Layout

| Path                     | Holds                                                                      |
| ------------------------ | -------------------------------------------------------------------------- |
| `app/`                   | Expo Router routes; thin files that compose feature screens                |
| `src/features/<area>/`   | Screens and view models per area (builder, letters, applications, career…) |
| `src/ui/`                | Design system: tokens (`src/ui/tokens.ts`), motion, `Text`, `Icon`, Kit    |
| `src/data/`              | Query client, drafts, offline queue, undo history, storyboard fakes        |
| `src/api/`, `src/auth/`  | Typed oRPC client and the OAuth session                                    |
| `src/render/`, `modules` | Server-rendered PDFs, rasterized into page images (`modules/pdf-pages`)    |
| `src/dev/storyboard/`    | Storyboard harness, scenarios and fixtures                                 |
| `store/`                 | Store listing copy and per-locale `releaseNotes`                           |

Web routes map to `app/(app)/…` by name: documents, builder, letter, applications, career, settings; the public
resume page is `app/r/[username]/[slug].tsx` and the ATS checker `app/ats-checker.tsx`.

## Checks

Run from the repository root with Node 26 (`mise exec node@26 -- …`). None needs a device.

```sh
pnpm --filter mobile typecheck
pnpm --filter mobile test            # Jest (jest-expo), src/**/*.test.ts(x)
pnpm --filter mobile test:ci         # CI's run; skips the storyboard edge test, which needs the local handoff bundle
sh apps/mobile/scripts/check-motion.sh   # prints nothing when clean
pnpm --filter mobile check:bundle    # Metro + Hermes export for both platforms, about 1.5 minutes
```

CI runs typecheck and `test:ci` through Turbo, and the motion check and bundle export when `apps/mobile/`,
`packages/` or dependency files change. Strings use Lingui macros; `pnpm lingui:extract` updates
`apps/mobile/locales` and fills empty translations from the web catalogs (`scripts/seed-locales.mjs`).

## Variants and devices

`APP_VARIANT` picks the build: `production` (`me.rxresu`), `development` (`me.rxresu.dev`, the default) or
`storyboard` (`me.rxresu.storyboard`, fake data from `src/data`). The dev and storyboard variants install beside the
store app. Start the storyboard with `pnpm --filter mobile start:storyboard`. The spec for screens, layout and motion
is the handoff bundle in the git-ignored .agents/handoff/mobile-final folder (BUILD.md first); it exists only on the
maintainer's machine.

Simulators and emulators: one at a time on this machine, machine-wide, never in parallel. Take the device lock that
`PLAN.md` describes before any `xcrun simctl`, `adb`, capture or Maestro run, release it as soon as the capture ends,
and reuse the running Metro instead of starting another. `.maestro/` holds the storyboard UI flows; never point them at
a production account.

## Releases

There is no EAS and no OTA update: every change, JavaScript included, reaches users as a store build. A push to `main`
that touches the app's inputs builds both platforms and uploads them to TestFlight and Play Internal testing
(`.github/workflows/mobile-release.yml`, Fastlane in `tooling/mobile`). Bump `version` in `app.config.ts` before a new
App Store version and update `store/metadata.json` release notes. Procedure: `.agents/docs/runbooks/mobile-releases.md`;
workflow and secrets: `.agents/docs/runbooks/mobile-ci.md`.

## Parity exceptions

The owner's explicit decisions; every other web/mobile gap is a bug. Add new exceptions here with the date.

- Applications CSV export is web-only (2026-10-19). CSV import is on mobile.
- Employer-form autofill and the embedded browser are not on Android or iOS (2026-11-01). Mobile keeps review
  packets, copyable answers, exact approved PDFs and opening the form in the system browser.
