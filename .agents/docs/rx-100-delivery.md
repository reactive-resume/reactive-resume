# RX-100 delivery and acceptance

Linear: https://linear.app/amruth/issue/RX-100

## Scope and ownership

Codex owns RX-100; RX-99 remains Claude-owned. No subagents or Daybreak Blue.
Android/iOS employer-form autofill remains excluded by the owner decision recorded for RX-75.

| Finding | Responsible behavior and proof                                                                                                                                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A3-01   | Posting language initializes the letter; web/native Language changes preserve the design link. SQL and browser checks.                                                                                                                                                           |
| A3-02   | Offer schema preserves stated deadline, bonus, equity and start; previews expose all five terms. Date-only formatting does not shift zones.                                                                                                                                      |
| A3-03   | Coach shares owned answers, newest offer and last two replies only with application sharing enabled. Fresh projection at each SDK authorization; real HTTP deletion/off controls. Earlier chat messages remain shared.                                                           |
| A3-04   | Shared disclosure categories, conservative pending/error Knowledge presence, interview named for Debrief and briefing. Web/native component tests.                                                                                                                               |
| A3-05   | First future briefing lead; server rejects past schedules and disables expired scheduled execution. Schedule and job tests.                                                                                                                                                      |
| A3-06   | Confirmed receipt and message stage move commit atomically. User/application/artifact lock order, no-op retries, committed stage-write receipts and concurrent Forget test. Browser cancel/confirm and HTTP readback.                                                            |
| A3-07   | Owned application origin survives editor navigation on web/native; browser Back test.                                                                                                                                                                                            |
| A3-08   | Built-in reader removes form controls/EEO boilerplate without stripping role content. API/import tests.                                                                                                                                                                          |
| A3-09   | Pasted, returned description and message fields scroll within bounded height. Browser geometry.                                                                                                                                                                                  |
| A3-10   | Relevance/gaps/page-fit prompt included. Private before/after renders now measure printed pages and estimated overflow-line change beside Accept all on web/native. RX-99 tailoring rules and RX-147 semantic page mapping are composed; final hosted CI/review remain required. |
| A3-27   | Employer-facing reply/answer language and register follow employer input; explicit reply-language override. Prompt contract tests, not a live-model accuracy guarantee.                                                                                                          |
| A3-28   | Answer prompts retain authored facts and support review notes; measured word/character caps never crop text. Approximate/floor parser controls.                                                                                                                                  |
| A3-29   | Draft commits the current question; first physical pointer click generates. Browser check.                                                                                                                                                                                       |
| A3-30   | Saved-revision, account-scoped unkept drafts; late completion/restore/Keep fenced by visit, operation and owner. Web/native store/caller regressions and browser reload proof.                                                                                                   |
| A3-31   | Structured title/company precede model guesses; escaped newlines decoded. API/import tests.                                                                                                                                                                                      |
| A3-32   | Read error survives paste fallback. Web/native error copy and web component test.                                                                                                                                                                                                |
| A3-33   | Reuse merged RX-72 tailoring-copy guard; RX-100 does not duplicate assistant actions. Verify final RX-99 composition before whole acceptance.                                                                                                                                    |

## Evidence boundaries

Local: production build, affected typechecks, web/native host/schema/utils/import tests, PostgreSQL lifecycle/locking,
real SDK/HTTP approval checks, Chromium pointer/navigation/storage/geometry, lint/format/boundaries/Knip.

Hosted CI and review are separate gates. No physical native UI, live-model semantic quality, deployment, OTA,
store submission or employer-site compatibility is claimed. New native behavior is JavaScript-only by source inspection.
