# RX-80 hosted background application execution: evaluation and decision

Decision (November 2, 2026): **no-go**. Do not build hosted or background execution of job applications. RX-80 is deferred until user-triggered browser assistance (APP-05/APP-06) shows demand and reliable behavior. That prerequisite is not met, and the owner has narrowed it further. This record lists the requirements a future proposal must meet, so the question doesn't have to be reopened from scratch.

## Where the prerequisite stands

- On November 1, 2026 the owner removed Android/iOS autofill and the embedded browser from RX-75: "I do not like the feature implementation." The exception is listed under "Parity exceptions" in `apps/mobile/AGENTS.md`.
- What ships is account-backed **review packets**: exact approved PDFs, copyable answers, and opening the employer form in the system browser. On desktop, autofill is an **experimental helper** limited to the active page. Its proof covers synthetic Greenhouse, Lever and Ashby control shapes only, with no live ATS acceptance claim. See `research/employer-form-autofill-v2.md`.
- No measurement of helper usage or fill reliability exists yet. Background execution would extend a feature the owner has scaled back and that has no reliability data.

## Requirements any future proposal must meet

These come from the RX-80 scope and the RX-75 safety rules. A proposal that can't meet all of them stays no-go.

1. **Separate executor.** Browsers run in an optional external service behind a stable contract (queue in, signed result out), never inside the core server. Self-hosters without it lose nothing. Rendering (Forme) stays separate from automation.
2. **Per-application authority.** Each run needs the user's explicit approval of one application, one fingerprinted packet and one destination URL. A match score, a saved search or a schedule never authorizes a run. Autonomous discovery-to-submission is a separate question and is out of scope.
3. **Idempotency and duplicate prevention.** One run per approved packet. A retry after any step that may have reached the employer goes to the user as "outcome unknown", never re-submits. Cancellation and a hard timeout apply to every run.
4. **Outcomes with evidence.** Separate _attempted_, _submitted_ (only with a confirmation page or employer email), _failed_ and _unknown_. A stage change to Applied needs _submitted_.
5. **Snapshots.** Each run records the exact document versions and answers used, as RX-75 packets already do.
6. **Manual handoff.** Sign-in, captcha, unsupported controls and multi-page forms stop the run and hand back to the user with what was filled. No captcha or bot-check bypass.
7. **Operating limits.** Before building, write down hosting cost per run, the supported-site list and who maintains it, the support load for failed runs, and the legal and ToS review for each ATS.

## Revisit when

- The desktop helper (or a successor the owner approves) has opt-in reliability data: fill accuracy and manual-handoff rate on real forms, measured the way RX-75's evidence ledger describes.
- Users repeatedly ask to apply while away, which is the need a background run exists for, not just faster filling.
- The owner reverses or replaces the November 1 decision for the platforms in scope.

Until then, faster applying is served by the existing review packet, copyable answers and the desktop helper.
