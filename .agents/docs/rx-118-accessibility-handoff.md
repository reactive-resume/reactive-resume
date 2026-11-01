# RX-118 accessibility and localization integration

This PR covers persistent browser preferences, route titles and focus, contextual labels, tablet drawer layout, control contrast, and RTL isolation for addresses and shortcut glyphs. It does not close the entire RX-118 issue.

## Composition

The branch is composed with current main, including reduced-motion behavior, query-preserving language links, builder Undo and Fit controls, canonical application stage clocks, offer deadlines, account fences, and document loading safeguards. Tablet drawer opening resets zoom to Fit without changing the numeric zoom limits or content reduction algorithms.

Explicit locale and theme choices use root-path, SameSite=Lax cookies with a one-year lifetime. Existing URL and cookie precedence is preserved. Theme remains local to the browser/device. Native preferences already persist in SQLite. Account locale synchronization and first-visit browser-language matching remain separate RX-111/RX-154 work; this change does not claim those features.

Contextual labels distinguish closed applications, command execution, absent attached documents, and empty resume/letter selectors. Catalog composition preserves existing translations from both parents. Translation completeness checks do not constitute native-speaker review.

Path navigation focuses a heading or main region while leaving query-only navigation and open modal focus intact. Shared control borders use a contrast token separate from decorative rules. URL/email/telephone fields and shortcut glyphs remain LTR within RTL interfaces; ordinary native text retains its existing direction behavior.

## Validation and release scope

Use web unit tests for preferences, titles and navigation focus; native field and experience tests for input direction and labels; and production Playwright accessibility, document title, motion and workflow tests for composition. Inspect the captured fictional guide screenshots against the combined UI. Report device and linguistic validation separately from automated checks.

Changes affect JavaScript, styling, copy and translations. No native dependency, native permission, database migration, deployment, store build or store upload is part of this PR.
