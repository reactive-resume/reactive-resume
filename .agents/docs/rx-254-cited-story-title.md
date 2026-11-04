# RX-254: cited story handoff and Coach titles

Retained RX-157/RX-97 findings A4-25 and the optimistic-title clause of A4-27. Other A4-27 privacy/setup/schedule clauses retain their separate parent receipts. Original RX-123 and RX-202 remain untouched.

## Behavior

Saved preparation steps can carry optional supporting fact IDs. Generation filters them against its actual owned context and keeps them in provenance. Web and native Draft story pass the step into their existing editors. Only active, nonblank, shared facts can initialize a shared story; unknown, private, forgotten and excluded facts are omitted. Older saved steps can match a complete verbatim fact with normalized whitespace and word boundaries. No semantic inference. Existing drafts and reviewed deselections remain authoritative. Native waits for the facts query before mounting its one-time initializer and retains loading/error/retry. Opening the editor neither saves a story nor sends an AI request. Existing server validation remains responsible for saving.

Optimistic Coach titles and persisted titles reuse the unchanged server rule through the existing universal string utility: normalized whitespace, whole-word cutoff, one ellipsis and surrogate protection. The full message remains intact. Normal-flow Career pages reserve phone bottom space above fixed shortcut help and navigation; Coach keeps its existing bounded transcript layout. Native EditorSheet retains its existing inset owner.

## Evidence

Baseline production Chromium detected an unchecked explicitly quoted fact after positive title/note controls, and a pending title ending in three dots. Candidate production: all four desktop/390px legacy/explicit handoffs pass using normal pointer Save, deselect/reload/reselect and protected saved-story readback. Pending title matches persisted DB title and full-message readback. Four additional PDF/header/editor browser consumers pass: nine cases total. A separately captured passing desktop handoff supplies the unedited fictional guide image.

Fresh checks: 115 real-PostgreSQL Career service tests, 38 Agent consumer tests, 24 schema tests, 18 string utility tests, 40 Knowledge tests, 21 Coach tests and 15 root-context tests. Knowledge and root-context suites ran separately after a combined run lost an unfinished draft; the failed run remains recorded and is not a pass. Native: 307 host tests, including actual editor citation/deselection and preparation loading/error/readiness. Five affected typechecks, lint/format/boundaries, generated OpenAPI, documentation check and production build. Docs checker retains 261 existing advisories. Both platform Hermes artifacts are validated separately from device behavior.

Hosted CI and CodeRabbit skipped under owner instruction. No native-device automation retried. Physical device, screen reader, live-provider quality and deployment remain unverified. Local proofs use only isolated databases, fictional records and owned ports/cache. Historical failing runs retained in the RX-157 cache.
