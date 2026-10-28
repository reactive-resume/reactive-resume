# TanStack Redact evaluation

Measured October 27, 2026 against source `b700ed9d7309dfc9fba0c33e0bf5429811f0b610`, React 19.3.1,
Redact 0.2.0, Vite+ 1.3.0, Node 24.22.1, Chromium 156.0.8078.4. Dependency is pinned for reproducibility.

## Decision

**Removed on October 27, 2026; native React is the only runtime.** The gain (13.5% less eager JavaScript, about 6–7%
faster entry evaluation, small first-paint differences) is not worth carrying a second runtime: an existing
keyboard-focus browser test fails with Redact, Redact 0.2.1 still doesn't focus `autoFocus` controls on mount, and
the interaction risks below are unmeasured. The rest of this page records the evaluation as it ran.

The opt-in build mode (`pnpm --filter web build --mode redact`), its resolver test (`apps/web/src/redact.test.ts`) and
the benchmark script (`tooling/redact/benchmark.mjs`) live in commit `a23bbd068`. Restore them from there to
re-evaluate, after upstream fixes mount-time focus.

In that mode, no application React imports, shared package APIs, mobile runtime, or backend runtime changed. React
Compiler stayed enabled. Redact's default `full` preset was retained; no optional compatibility features were removed
to improve results.

## Integration boundaries

- Redact's Vite plugin aliases the web DOM runtime and its server prerenderer.
- `packages/pdf`, `@formepdf/react`, `react-reconciler`, and React's own internal imports retain native React, JSX,
  compiler runtime, and scheduler resolution. Our Forme/template renderer uses `react-reconciler`'s private dispatcher;
  Redact's ordinary React entry does not expose the internals it expects. Aliasing that graph wholesale is unsafe.
- PDF workers retain their existing native React build. The main-thread PDF fallback and resume web-page preview
  also reach the native template graph through the importer-based resolver.
- The same resolver runs in Vite's dependency optimizer. Without it, development prebundles imported native React
  inside TanStack Router and failed with an invalid-hook-call/null dispatcher, even though production builds worked.
- Redact-mode prerendering bundles dependencies (`ssr.noExternal: true`). The unmodified plugin integration failed
  prerendering with `Cannot read properties of undefined (reading '_currentValue')`: external dependencies were
  still constructing native React contexts while the bundled renderer used Redact.
- Config tests cover native production defaults and resolution of both runtime graphs, including compiler runtime
  and scheduler. They are complemented by real browser PDF export coverage; they do not prove every third-party
  component compatible.

## Measured bundle difference

Sizes are bytes compressed with Node's default gzip, summed **per file**. Decimal KB below means 1,000 bytes.
Eager JavaScript is the browser entry, HTML module preloads, and recursively followed static JavaScript imports;
it excludes lazy route imports. All JavaScript includes emitted locale chunks and workers; it is not a page download.

| Output                         | Native React |      Redact |           Difference |
| ------------------------------ | -----------: | ----------: | -------------------: |
| Eager JavaScript, gzip         |    340,880 B |   294,793 B |  -46,087 B (-13.52%) |
| Eager JavaScript, uncompressed |  1,066,294 B |   888,845 B | -177,449 B (-16.64%) |
| All emitted `.js`, gzip        |  7,266,329 B | 7,216,429 B |   -49,900 B (-0.69%) |

Both builds emitted 322 `.js` assets, with 45 in the eager graph. `.mjs`, CSS, fonts, images, and WASM are outside
these JavaScript totals. Keeping native React for custom renderers is included in the Redact result.

## Measured public-page startup

One discarded warm-up per page/runtime, then ten fresh browser contexts per page/runtime, alternating renderer order.
Three routes, 60 retained samples. Chromium uses 4x CPU throttling, light color scheme, English locale, and reduced
motion. Both snapshots use the same loopback gzip static server, deterministic signed-out public API fixtures,
no browser cache, and blocked external requests. No network latency or bandwidth throttling is simulated.

| Route          | Entry module evaluated: React / Redact | First contentful paint: React / Redact | Script execution: React / Redact |
| -------------- | -------------------------------------: | -------------------------------------: | -------------------------------: |
| `/`            |                       391.1 / 362.3 ms |                           308 / 298 ms |                 379.8 / 239.5 ms |
| `/ats-checker` |                       241.9 / 226.8 ms |                           112 / 110 ms |                 285.2 / 199.8 ms |
| `/auth/login`  |                       233.1 / 219.4 ms |                           116 / 114 ms |                 262.3 / 224.4 ms |

Values are medians, not confidence intervals. Entry evaluation is measured by the entry module script's `load`
event, including its top-level awaits; it is not time to interactive. Script duration is Chromium's accumulated
`ScriptDuration`, sampled after a successful theme toggle or login-input fill, not a pure renderer microbenchmark.
The benchmark asserts those interactions succeed and that no page exceptions or HTTP error responses occur.

Local entry evaluation improved about 6–7%; script execution was lower in this workload. First-paint differences
were small. These results do not establish field INP, LCP, typing latency, authenticated builder performance,
hydration performance, mobile-device performance, or behavior on a real network. Marketing HTML is prerendered and
then replaced with `createRoot`, so the app does not hydrate those pages. Raw samples: [redact-results.json](./redact-results.json).

## Compatibility findings

Sources: [compatibility chart](https://tanstack.com/redact/latest/docs/compatibility),
[Vite integration](https://tanstack.com/redact/latest/docs/vite-plugin),
[integration verification](https://tanstack.com/redact/latest/docs/verification),
[upstream performance evidence](https://tanstack.com/redact/latest/docs/performance).
The published package source was also inspected; documentation claims are not substitutes for our app's tests.

| Area                           | Consequence for this app                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmed: autofocus**       | `section-editing.spec.ts:16` fails after Add experience: Position exists but is not focused. Same test passes on native React. Redact's DOM setter emits `autofocus` but has no React-style commit-time focus handling; the app clears its one-time focus request in an effect. Do not weaken the accessibility assertion or change app behavior to mask this. |
| **Confirmed: custom renderer** | Native dispatcher isolation is required for PDF/template rendering. A global React alias is insufficient. Keep isolation when upgrading; retest PDF worker, main-thread fallback, and web-page preview.                                                                                                                                                        |
| **Confirmed: prerendering**    | Plain `redact()` failed the existing production prerender build. Bundling SSR dependencies consistently fixes the observed mixed-context failure. This changes the prerender bundle graph and can affect build cost.                                                                                                                                           |
| Scheduling                     | Rendering stays synchronous; no time slicing or interruptible renders. `useDeferredValue` in resume checks, application search, and career knowledge search loses React's concurrent scheduling guarantees. Large resumes/lists and slower devices need responsiveness testing.                                                                                |
| Suspense and transitions       | APIs exist, with different scheduling. Dialogs, lazy editors, PDF.js preview, Query suspense, and router transitions warrant app-level regression tests. Upstream measurements include slower Suspense retries and passive effects; its microbenchmark ratios are not our app's timings.                                                                       |
| React Compiler                 | Compiler entry is implemented and aliased, but upstream explicitly does not validate every compiler output pattern. Existing compiler test passes; that is not exhaustive behavioral proof.                                                                                                                                                                    |
| DOM/forms/portals              | Upstream reports shared React tests. Our auth, rich-text keyboard controls, guest flow, JSON import/export, sharing, and shaped-script PDF download tests pass in Redact mode. Autofocus is a concrete exception. Drag-and-drop, cropper, virtual lists, all dialogs, and streaming assistant behavior remain outside this focused gate.                       |
| Debugging                      | StrictMode avoids React's double invocation. `<Profiler>` callback is a no-op. Development DevTools support does not restore those diagnostics; no Profiler-based speed claim is made.                                                                                                                                                                         |
| SSR/cache                      | String/static rendering and streams exist, but full Fizz prerender/resume APIs do not. `cache` is an identity wrapper, `cacheSignal` is null, and client cache refresh is a no-op. Our current build-time string prerender works; backend/public resume rendering retains native React.                                                                        |
| Animation/browser differences  | Redact's native ViewTransition animation feature stays disabled by default. Router use of browser view transitions is separate. Upstream lists unresolved native-animation, hidden-tab/resource/navigation, and Safari/Firefox verification gaps; do not infer unsupported browsers, or claim our app verified in them.                                        |
| Release maturity               | This is a 0.2.0 alternative runtime. React API coverage and upstream test counts do not guarantee compatibility with all current/future dependencies. Keep the pin and native control when evaluating upgrades.                                                                                                                                                |

## Validation

- Both native and Redact production web builds pass; all three marketing pages prerender for the configured locales.
- Server production build passes; server stays on native React.
- Web unit suite: 86 files, 370 tests passed. Vitest uses its normal native-React config, so this is a regression
  check for our source/config changes, **not** a claim that 370 tests ran against Redact.
- Web and tooling typechecks, repository lint/format checks, and package boundaries pass.
- Redact production Chromium gate: 6 passed, 1 failed across auth, guest conversion, JSON import/export,
  section editing, PDF downloads, and sharing. The failure is the focus assertion above.
- Native production control: all seven tests in the same focused gate passed, including that same focus assertion.
- Redact development smoke: homepage theme toggle and login-input fill passed without page exceptions, with public
  APIs stubbed. This verifies the optimizer integration, not authentication or PDF rendering in development.
- Final native and Redact client output each matched their benchmark snapshot byte for byte. Normal native React
  build output was restored after evaluation.

No hosted CI, deployment, complete cross-browser suite, or real-device benchmark is claimed. Before enabling by
default, resolve the upstream focus behavior, repeat the browser gate, and measure large-resume typing/search,
PDF fallback/preview, assistant streaming, drag-and-drop, and Safari/Firefox behavior.

## Reproduce the benchmark

Check out commit `a23bbd068` (or restore its files) first; the build mode and script were removed afterwards.
Run from repository root with installed dependencies and Playwright Chromium available. No database or production
credentials are used by the benchmark server. Build snapshots are outside the checkout, so later builds do not alter
the control. Run the browser benchmark after other build/test processes have finished.

```sh
bench_dir="$(mktemp -d)"
pnpm --filter web build
mkdir -p "$bench_dir/react"
cp -R apps/web/dist apps/web/dist-prerender "$bench_dir/react/"
pnpm --filter web build --mode redact
mkdir -p "$bench_dir/redact"
cp -R apps/web/dist apps/web/dist-prerender "$bench_dir/redact/"
node tooling/redact/benchmark.mjs "$bench_dir/react" "$bench_dir/redact" "$bench_dir/results.json"
```

For the real browser compatibility gate, use the disposable-database setup in `tests/e2e/README.md`, build with
`--mode redact`, build the server, then run the existing specs. Never point those tests at production data.
