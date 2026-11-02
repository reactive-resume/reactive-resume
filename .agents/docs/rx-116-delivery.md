# RX-116 delivery

Issue: https://linear.app/amruth/issue/RX-116

Composed against main `24e7d9727702a746a19f69b82350ac3f43e13f2f`. RX-113 and RX-110 are Done;
their merged behavior is reused. The earlier frozen candidate's review or dependency status is not delivery evidence.

## Acceptance map

| Finding                  | Responsible implementation and verification                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L5-02 independent sender | Reuse RX-113 sender fields and photo control on web/native; `letter-sender.spec.ts` exercises standalone edits, export and linked-copy isolation.                                                |
| L5-03 submitted targets  | Submission hints in application summaries; disabled targets and shared refusal reason on web/native. Browser and real RPC/SQL tests preserve submitted snapshots.                                |
| L5-04 conflict edits     | Web write panel stops typing; existing reload recovery keeps edits in a standalone copy. Native uses its existing draft conflict owner. Panel/store/recovery and native host tests pass.         |
| L5-05 return to job      | Preserve selected application ID through document creation, builder links and native routes. Back-link tests and shared-resume browser regression pass.                                          |
| L5-06 linking/sender     | Existing letter selection in application forms/detail, document-side links and explicit new-letter resume choice on web/native. One transactional link owner reconciles forward/reverse aliases. |
| L5-07 record/workspace   | Workspace links to Stage, details and timeline; detail retains Open workspace. Guides describe both surfaces.                                                                                    |
| L5-08 Undo               | Reuse RX-110 deferred stage writes and shared baselines; Undo does not write compensating false history. Current web/native host and real application tests pass.                                |
| L5-09 stage prompts      | Reuse shared offer-aware Next step and closed Outcome; hide closed preparation actions. Current schema/web tests pass.                                                                           |
| L5-11 truthful fit copy  | Homepage/form describe requirement fit checks. Regression checks reject the old match-score promise.                                                                                             |
| L5-14 Notes/activity     | Web/native use Log an update / Log and explain dated updates versus Notes. Refreshed fictional screenshot matches the wording.                                                                   |
| L5-15 posting editor     | Reuse RX-110 single posting editor/status; retain current account fences and retry identity. Current posting and copy-for-job tests pass.                                                        |

## Data invariants

- Link changes reconcile every affected forward owner and reverse alias, including stale/null reverse pointers.
  Locked affected letters refuse atomically. Ambiguous surviving owners return conflict. Foreign records remain untouched.
- Submitted receipts remain immutable. A nullable internal `application.submitted_at` records lifetime submission
  independently of editable timeline entries; reopen/metadata changes cannot create a receipt for a late-linked draft.
- Migration backfill uses sent stages, sent-stage history or actual sent-version references. A Saved row's default
  `applied_at` is insufficient. M02 reproduces and fixes a receipt-only Closed-row backfill omission.
- Migration upgrade on a disposable database advanced 57 to 58 migrations, preserved all old fields, left a never-sent
  Saved marker null, populated the submitted Closed marker and reapplied idempotently. Retain the additive column on rollback.
- Internal marker is omitted from public application DTOs; submission hints in summaries are optional for older servers.

## Verification

All checks below ran on this current-main composition:

- Full API suite: 4,219 passed, including real PostgreSQL link/submission regressions.
- Focused document/letter/career RPC-to-SQL campaign: 190 passed.
- Full web suite: 757 passed, nine opt-in tests skipped.
- Schema: 165 passed; resume: 321 passed; mobile host: 88 passed.
- Production browser campaign: 15 passed, one guest-merge case skipped by its configured gate.
- Web/mobile/API/DB/schema typechecks; production build; OpenAPI generation.
- Android and iOS Hermes exports; Lingui extraction; root lint, formatting, Turbo boundaries and Knip.
- Application detail and submitted-letter picker captures refreshed from fictional local production fixtures and inspected.

The first broad campaign failed on six outdated web mocks and missing loopback-AI test configuration. Fixtures were
updated without weakening assertions; the full web/API reruns above passed. Root Knip reports two redundant-entry
configuration hints, with no unused-code failure.

Hosted PR CI/reviews are separate gates. Native device interaction, signed builds, store delivery and production
deployment were not verified by these host tests/exports. New catalog messages retain normal source-language fallback
where translations are unavailable.
