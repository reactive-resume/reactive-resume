# CI performance audit — 2026-10-27

Scope: all six checked-in workflows plus GitHub-managed CodeQL. Baseline checkout:
`79f51c1c21d819a9f49a1f35dd74a93ff80fdfa6`. This is a focused cost/ownership audit, not a whole-repository test purge.

## Changes in this PR

- Run unit and browser suites in independent matrix jobs, each with its own PostgreSQL service and Turbo cache namespace.
- On 32-vCPU Blacksmith runners, run four package test processes (two Vitest workers each) and four Playwright workers.
  GitHub-hosted runners and local unit scripts retain their serial limits; Vitest isolation and package-local module caches stay enabled.
- Use fixed public credentials exclusively for disposable CI services. Turbo still hashes runtime secrets; previously,
  freshly generated credentials invalidated every cacheable unit task on every run. API, database, server, and tooling
  integration tasks retain their explicit cache opt-outs. Browser tests always execute against a migrated database.
- Preserve all 21 browser tests. Consolidate repeated deployment-probe rejection loops while retaining every guard.

## Measurements

Hosted baseline: [E2E run 40416118497](https://github.com/reactive-resume/reactive-resume/actions/runs/40416118497),
commit `f77121efee0dfa65eb9b70229342bae7356dc3d8`, immediately before the baseline checkout's documentation-only change.
The combined job used a 32-vCPU Blacksmith runner: unit tests 130s, build 28s, browser tests 68s; 20 unit tasks and
21 browser tests passed. Unit tasks had 0/20 cache hits even though the outer Actions cache restored successfully.
Vercel artifact build took 97s; Cloudflare build/check 40s plus smoke 15s. Step durations exclude queue time.

Local benchmark: macOS arm64, 10 logical CPUs, 32 GiB RAM, Node 24.22.1, pnpm 12.15.0, PostgreSQL 16 in Docker.
Two dedicated databases, isolated local storage, and one unchanged environment were reused between commands.
No other benchmark ran concurrently. Forced unit measurements bypass Turbo task results with `--force`; dependency
and filesystem caches were not cleared between runs. Browser runs use the same production build, zero retries,
and no skipped tests. These are local measurements, not promises of hosted-runner elapsed time.

| Measurement                                          |  Before |      After | Result                                                               |
| ---------------------------------------------------- | ------: | ---------: | -------------------------------------------------------------------- |
| Full unit task execution (`--force`, 1 → 4 packages) | 149.27s |     57.51s | 61.5% faster; all 20 tasks passed, 2,393 → 2,391 tests, zero skipped |
| Warm unit run (4 packages, unchanged inputs)         |       — |     24.08s | 16/20 task cache hits; all four uncached integration tasks still ran |
| Browser execution (1 → 4 workers)                    |  61.28s |     21.42s | 65.0% faster; all 21 tests passed on both runs                       |
| Production build for both browser runs               |  28.33s | Same build | Build succeeded; no application runtime change                       |

A same-code serial control after consolidation also passed all 2,391 tests in **139.31s**; four-package execution
was **58.7% faster** even against that warmed control. The first baseline includes the two consolidated cases.

Reproduce with the disposable-service environment from `tests/e2e/README.md`, also setting
`COVER_LETTER_TEST_DATABASE_URL`, `INTEGRATIONS_TEST_DATABASE_URL`, and a separately migrated `OAUTH_TEST_DATABASE_URL`:

```sh
pnpm exec turbo run test:ci --concurrency=1 --force
pnpm exec turbo run test:ci --concurrency=4 --force
pnpm exec turbo run test:ci --concurrency=4
pnpm build
CI=true pnpm exec playwright test --workers=1
CI=true pnpm exec playwright test --workers=4
```

The matrix also overlaps unit work with browser build/testing. That structural benefit is not added to the local
numbers as though it were a measured end-to-end hosted result. A second runner adds service/setup overhead and
can increase runner minutes; compare Actions duration and billed usage after merging. New check names are
`Unit tests` and `Browser tests`; external branch protection that requires the old combined name must be updated.
The repository currently exposes no required-status-check protection; exact-commit promotion checks the whole
E2E workflow conclusion, so both matrix legs remain required for promotion.

## Test audit and preservation

`tooling/mobile-updates.test.ts` executes the real production OTA shell guard from `docker-build.yml` with local
HTTP-command fixtures. Previously, unhealthy status and unrelated service each repeated the same failing loop
60 times. One rolling sequence now inserts each invalid response after two healthy matches, then requires three
fresh matches. It asserts success at exactly 12 probes. Immediate success at 3 and permanent mismatch failure at
60 remain. Total fixture probes: 190 → 75, removing 115 redundant shell/curl/jq invocations, with two fewer table
cases. No production runtime code or test-only production seam changed. Test LOC increases because the combined
sequence explicitly spells out the independent reset controls; deletion count was not the objective.

Mutation proof: removing revision, status or service validation makes the rolling keeper fail with 3, 6 or 9
probes instead of 12. Removing the reset makes it fail at 4. All four mutations failed at the intended exact-count
assertion, and the production workflow was restored byte for byte. Full owner/sibling suites passed before and
after consolidation. Full-suite test declarations decrease by two; runtime production LOC change is zero,
test LOC is +16 (19 added, 3 removed), and no support files/exports are orphaned.

All browser cases retain distinct transport/persistence/security/lifecycle proof: auth and guest ownership;
failed-save navigation for separate resume/letter stores; import/export; sharing/password/redirect/statistics;
OAuth consent and PKCE; private AI report deletion; assistant proposals/cancellation; career evidence and
job-document snapshots; browser font loading and PDF ActualText; optional web-provider persistence. Per-test
accounts, browser contexts and scoped cleanup, ephemeral stub ports, and intercepted OAuth callbacks permit parallelism.

Inspected tooling release, cache, lint, generated-language/documentation and recovery tests also remain: they
protect independent executable/configuration/public contracts. Preview cancellation/pixel-budget, cached auth
fallback, and WebMCP adapter tests remain. Static or small tests were not deleted merely for looking menial.
Independent preservation review found no lost contract or new cache/database isolation issue.

## Workflow-wide recommendations

| Workflow                  | Current evidence / caching                                                                                                                                                                                    | Next improvement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e.yml`                 | Serial 130s unit + 28s build + 68s browser baseline; pnpm and Turbo caches already restored.                                                                                                                  | This PR fixes secret-induced cache misses and adds bounded parallelism. Profile new hosted runs before adding shards. Cloudflare currently calls web build directly without Turbo; a follow-up can route that build through Turbo with declared build inputs and its own cache namespace. Keep real runtime smoke and Vercel artifact proof.                                                                                                                                                               |
| `autofix.yml`             | Recent successful job: dependency install 1s, setup/cache restore 19s, Knip 3s, lint/format 7s.                                                                                                               | Keep mutating Knip/lint/format uncached: a cached success would not reproduce edits. If setup remains dominant, benchmark a Blacksmith sticky disk for the pnpm store rather than adding more task caching.                                                                                                                                                                                                                                                                                                |
| `docker-build.yml`        | Native AMD64/ARM64 builds already parallel; Blacksmith persists BuildKit layers and pnpm mounts per architecture. Sample build steps 76s/144s, anonymous pulls 48s, Docker Hub mirror 273s, OTA publish 353s. | Largest follow-ups: move best-effort Docker Hub mirroring off the deployment/OTA critical path while preserving digest/signature evidence; profile OTA bundling on a larger runner or use an unsigned Metro transform cache keyed by toolchain/lockfile. GitHub fallback currently has no cross-run Docker layer cache: benchmark `type=gha` per architecture there only, without stacking it onto the Blacksmith builder. Preserve every SHA image, exact-commit CI, signing, and backend-revision gates. |
| `mobile-release.yml`      | Platforms already matrixed; pnpm and Ruby/Bundler dependencies cached. Latest Android build step 411s; store submission 72s, excluding approval waits. No explicit Gradle or CocoaPods download cache.        | Benchmark dependency-only Gradle/CocoaPods caches or Blacksmith sticky disks keyed by OS/toolchain/lockfiles. Avoid signing files, generated signed output, keychains, and broad workspace caches. Keep approval boundaries and exact-commit CI; build-number/fingerprint evidence cannot be reused from another release.                                                                                                                                                                                  |
| `mobile-forme-native.yml` | Manual macOS job installs pinned Rust toolchain, cbindgen/cargo-ndk, then builds five targets serially with four jobs each; no explicit Cargo cache. No recent hosted run available for timing.               | Cache Cargo registry/git downloads and pinned installed tools first; then benchmark target build caching keyed by Rust/NDK/Xcode/Cargo.lock. Preserve clean header/notices comparison, artifact checksum verification and immutable publishing. Do not introduce five simultaneous four-thread compiles without a memory benchmark.                                                                                                                                                                        |
| `issue-maintenance.yml`   | Already lightweight 2-vCPU jobs; no dependency installation. Stale job needs no checkout.                                                                                                                     | No build/test cache needed. Label job could use sparse checkout of its single imported script, but expected saving is small; retain form-derived labels and stale policy.                                                                                                                                                                                                                                                                                                                                  |
| GitHub-managed `CodeQL`   | Default setup scans `actions`, on standard runners; recent runs about 50s including scheduling. Not a checked-in workflow.                                                                                    | Keep independent security analysis. No Turbo task output or dependency cache applies to its current Actions-only analysis.                                                                                                                                                                                                                                                                                                                                                                                 |

Blacksmith documentation confirms `actions/cache` and `actions/setup-node` dependency caching are accelerated
transparently on its runners; replacing working actions with extra wrappers is unnecessary. Existing observed
pnpm archive is approximately 684 MB, while Turbo archives are about 40–79 MB. Sticky disks are an experiment
for transfer/extraction cost, not a substitute for correct Turbo hashes. A remote Turbo service would require
credential/trust design for fork PRs; current cache transport already works and needs no new credentials.
Keep Vercel, browser, unit, and any future Cloudflare artifact namespaces separate until build-environment inputs
are deliberately audited. Browser binaries are not cached here: Playwright installation was 12s including OS
dependencies, and another archive restore may not improve that.

Sources: [Blacksmith dependency caching](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions),
[sticky disks](https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks),
[Docker caching](https://docs.blacksmith.sh/blacksmith-caching/docker-builds), installed Turbo 2.11.10 docs,
and Playwright's current parallelism/isolation documentation. Timing samples:
[Docker 40416118446](https://github.com/reactive-resume/reactive-resume/actions/runs/40416118446),
[autofix 40417598213](https://github.com/reactive-resume/reactive-resume/actions/runs/40417598213),
[mobile 40206816901](https://github.com/reactive-resume/reactive-resume/actions/runs/40206816901).

## Validation

Passed: production build; complete unit suites at one and four package concurrency; warm-cache run; all 21
browser tests at one and four workers; four targeted guard mutations; tooling typecheck; repository-wide
`pnpm lint:agent`, `pnpm format:check`, `pnpm knip`, `pnpm exec turbo boundaries`; `git diff --check`; and
all-workflow actionlint with existing Blacksmith runner labels declared in a temporary actionlint config.
No native release/store submission or new hosted speedup has been measured by this local validation.
