# RX-119 delivery evidence

Issue: https://linear.app/amruth/issue/RX-119

Base: `d359340777eddf0cc7b0921d5672c85388d3288c`.

## Acceptance

| Finding | Result                                                                                                                                                                                         | Proof                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L8-01   | Five font-pairing and eight accent descriptors resolve at render time, including letter Design note. Existing translated native lists retained.                                                | German production-browser radios, titles, canvas label and letter note; saved design read back through HTTP.                                                                                        |
| L8-03   | Loading/canvas/caption labels and ATS page badges use Lingui; PDF error gives upload recovery.                                                                                                 | Focused web regressions and full web suite; actual German canvas in production browser.                                                                                                             |
| L8-06   | Web and native reuse their existing confirmation dialogs for credentials and domains. Keep cancels without removal. Key copy explains reconnection; domain stays connected until confirmation. | Component/host regressions plus real PostgreSQL row fingerprints and timestamps before opening, after cancellation and reload; explicit confirmation deletes the row. Domain GET then returns null. |

Confirmation was chosen for domains as allowed by the finding: it preserves live routing until approval without introducing delayed mutation ownership. No API/schema/dependency changes. Native already translated design presets, so this change does not introduce a shared UI-config package.

## Fresh local checks

- Before composition: five web regression cases and two native cases failed as expected on the base.
- After composition: 10 focused web tests passed; full web suite 762 passed, nine opt-in tests skipped. Existing Letter-paper regression retained with its required I18nProvider fixture.
- Full mobile host suite: 90 passed. After renaming the test loader to the existing `serverRequire` pattern, both affected native cases passed again.
- Web and mobile typechecks passed.
- Production build succeeded: three tasks, two cached (unchanged server/plugin), fresh web build.
- Android and iOS Hermes exports succeeded. No native runtime dependency/config change.
- Lingui extraction passed on both apps. Catalog audit: all 317,272 original nonempty translations unchanged; zero modified/lost.
- Three focused production Chromium tests passed with zero skips: German design/preview/letter labels, domain confirmation and web-access confirmation. Dedicated disposable PostgreSQL database and fictional credentials/domain; no provider or DNS traffic needed. CI browser step enables custom domains with disposable test-only settings.
- Screenshot opening animations disabled for capture. Both guide PNGs inspected after final capture: complete visible dialogs with matching copy and actions.
- Final root lint and formatting passed; boundaries checked 1,805 files across 23 packages with no issues. Knip passed with two existing redundant Lingui-entry hints. Actionlint and Git whitespace checks passed.

## CI follow-up

At head `3710c1f65d224e0b27e5f32d4424ac5ac0237aec`, CI unit checks completed successfully (20 test tasks, including 762 web tests with nine opt-in skips and 4,219 API tests). Both compatibility jobs, autofix, CodeQL and documentation checks passed; deployment smoke was skipped and spellcheck neutral. Hosted guide pages returned HTTP 200 with expected copy, and both hosted PNGs exactly matched the committed images.

Browser CI reported 251 passed, one skipped and two failed. Both failures reproduced locally on the unchanged head:

- The German photo regression selected the formerly English canvas label. Its selectors now assert the translated German canvas and loader names while preserving photo/crop/persistence checks.
- The primary-lookup fixture intercepted only a physical URL. With custom domains enabled, the trace showed `resume/list` inside `customDomain/get/__batch__`, returning HTTP 207 successfully instead of the intended outage. The fixture now reuses logical-RPC failure handling extracted from the existing provider-history test, preserving sibling responses. It verifies an actual failed lookup occurred, retains the real HTTP 404 precondition and disabled-Copy/error/recovery assertions, and advances the browser clock instead of sleeping 62 seconds.

After repair, both failed cases and the provider-history mixed-batch control passed (three tests, zero skips). All five affected browser specs then passed with four workers: 20 tests, zero skips, 27.1 seconds. Only test fixtures/selectors and this evidence record changed; the production build remains the one tested above. Current-head hosted CI must pass before merge.

## Provenance and limits

Frozen candidate base `40e4d3563af0d3a35435425087f991f25c1ea019`, tree `18d8595974935aa5d255348dcb2b3792595e2ddd`, patch SHA256 `8e84cbbc887c123e009da0c7db51969564ffdc3a58f307a4b85cf2edf2fa0b24`. Composed onto current main, preserving its Letter-size loader and LTR anchoring. Historical review was partial with no verdict; it is not an approval.

The local API suite was not rerun because API code is unchanged; the initial PR CI ran 4,219 API tests successfully. ATS PDF error text is source-covered but its error branch was not forced in production-browser QA. Native device interaction, human translation review, hosted CI, deployment and store delivery are separate gates; local host tests and exports do not prove them. Only merge after current-head CI and review refresh.
