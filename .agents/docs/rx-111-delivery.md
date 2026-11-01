# RX-111 delivery evidence

Composed onto main `4f66b8782a4fedbb188138d8d451111bb92be7d5` from frozen candidate tree
`014a90b62af937c53772f12570419531e51b1c7e`. Current-main account fencing and newer catalogs remain intact.
Foreign worktrees and their indexes were not edited. RX-105 remains Claude-owned; overlap was communicated in Linear.

| Finding                  | Implementation and proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J3-01 Arabic terminology | Corrected action nouns, headline, job match, checks, sharing, theme, counts and related copy in both Arabic catalogs; glossary records terminology. Catalog composition applies semantic translation changes while retaining current-main messages.                                                                                                                                                                                                                                                                                                                                           |
| J3-02 content direction  | Native browser first-strong direction uses view-only ProseMirror decorations, independent paragraphs/list items, scoped two-sided marker gutters, `bdi` for user values, and FSI/PDI for interpolated toast values. Saved HTML stays unchanged. Existing native text/editor direction remains platform-owned; native toast interpolation uses the shared isolate helper. Six current-production-CSS pixel cases and 32 edit/Undo/serialization assertions pass. Old compiled-direction and clipping controls each fail four of six cases. SQL readback preserves mixed-language HTML exactly. |
| J3-03 blank address      | Reuses merged RX-109 ownership. All 18 PostgreSQL address tests pass. Actual HTTP creation uses a neutral blank slug and publication preserves it through later Arabic edits.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| J3-04 phone contacts     | Public HTML folding permits shrink without growth. All 18 templates pass contact bounds at 390px and 1440px. Restoring the old rule reproduces Pikachu clipping. Committed Chromium regression passes. This is contact-layout coverage, not a general renderer verdict.                                                                                                                                                                                                                                                                                                                       |
| J3-05 account emails     | Nullable validated account locale, signup cookie and OAuth state capture, account-bound web/native synchronization, profile/export persistence and stateless localized email rendering. Missing translations or changed placeholders fall back per string to English. Actual HTTP/PostgreSQL/local SMTP campaign passes across all 54 selectable locales. Concurrent Arabic/German resets retain each recipient's language. Current-address approval, reset URL, one-hour expiry, single use and credential replacement remain intact.                                                        |

Current-main composition additionally uses the existing account-bound RPC for web locale sync, suppresses writes from
preloads/stale root loads, scopes native profile queries/writes to the rendered account, and excludes submitted values
from REST/RPC error logs. Both logging regressions fail with the original logger and pass with code-only logging.

## Fresh checks

- Eight affected package suites: 1,700 passed; nine opt-in web transport tests initially skipped, then explicitly run
  against the disposable server: 9/9 passed.
- PostgreSQL auth owner tests: 26/26; address tests: 18/18. Server privacy boundary: 17/17; auth adapter: 35/35.
- Chromium auth/document-title/application-context/phone-contact workflows: 8/8, no retries.
- Ten affected typechecks and production build: 3/3 tasks, no cache hits.
- Android and iOS Hermes exports; 87 native host tests, including account-replacement locale sync.
- Fresh migration upgrade: 56 to 57 migrations, existing user/resume fields identical, new locale null, one graph head.
- Lint, formatting, package boundaries and Knip pass. Public OpenAPI document regenerated. User guide and fictional
  preferences screenshot updated from the tested production build.

Evidence packet: `/var/folders/3n/ghfrlwh90rx96d18_md37n080000gn/T/rx111-sequential-d42cwell`.
No production, deployment, OTA/store or physical-device result is claimed. Arabic copy has no native-speaker signoff;
non-Arabic untranslated email strings retain English fallback. Other public-renderer layout issues remain outside
the phone contact fix. RX-105's future unmerged changes still require normal merge-time composition checks.
