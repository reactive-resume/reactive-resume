---
name: fill-translations
description: Fill missing Reactive Resume translations across all configured web and mobile locales using parallel subagents, then prove catalog completeness. Use for “fill translations”, “complete translations”, missing locale strings, or a request to ensure translations are complete before release. Cover existing gaps unrelated to the current task unless the user explicitly narrows scope. Do not activate for ordinary prose translation or a read-only audit that forbids edits.
---

# Fill translations

Finish every active catalog entry, including older gaps outside the current feature. Preserve existing translations and unrelated work. Technical completeness and linguistic quality are separate claims.

Run from the Reactive Resume checkout root. Follow its `AGENTS.md`, command wrappers, and current package scripts. Commands below match its Lingui 6 workflow; inspect installed `--help` if flags change. Use existing dependencies; no translation service or new dependency is required.

## Establish the baseline

1. Read `GLOSSARY.md` at the repository root (it is not in this skill folder), both apps' `lingui.config.ts`, relevant package scripts, and `apps/mobile/scripts/seed-locales.mjs`. Derive locales, source locale, and pseudo-locale from current config rather than a fixed locale count. Currently `zu-ZA` is a generated pseudo-locale, not Zulu translation work.
2. Capture `git status --short` and the initial diff. Save copies of catalog bytes outside the checkout so preservation checks compare against current work, not `HEAD`. Record pre-existing compiled locale files too. Keep staged/unstaged changes intact; no reset, checkout, clean, commit, push, or release unless separately requested.
3. Extract all source strings in both apps before dispatching workers, and before any build: production bundles drop source text, so a build from stale catalogs shows raw message IDs.

   ```sh
   pnpm lingui:extract
   ```

   It runs web, then mobile, then `pdf:translations`. Web's script cleans obsolete entries and overwrites the source locale from source messages; mobile's script also seeds empty entries from web. These extraction changes are expected. Compare preservation of active nonempty target translations against the post-extraction baseline.

4. Run both missing checks, capturing each exit code and verbose findings even when one fails:

   ```sh
   pnpm --filter web exec lingui check missing --mode catalog --verbose
   pnpm --filter mobile exec lingui check missing --mode catalog --verbose
   ```

   Redirect verbose output to a file and read counts or one locale at a time; the full log can exceed a million tokens. Inventory **all** missing entries by app and locale. Use installed `@lingui/format-po` through the owning workspace for structured inventory/edits; empty-line regexes misread multiline messages, headers, contexts, and obsolete entries. Keep msgid, context, translator comments, and source references with each work item. If no entries are missing, continue to verification without spawning translation workers.

## Translate in parallel

Complete web first, seed mobile again, then translate only remaining mobile gaps. This reuses shared strings and avoids duplicate or inconsistent work.

Assign disjoint whole locale files to workers. Keep a small bounded pool within available concurrency; balance by missing-entry count, group related locales where useful, and refill slots as workers finish. Never assign two writers to the same file, even for different messages. Give workers only missing messages plus relevant existing examples and source context instead of whole catalogs when possible.

Use the environment's delegated-task tools. In T3 Code, inspect `orchestrator_capabilities` and use `delegate_task` when inherited model options require it; preserve the current provider/model/options unless the user requests another selection. Use shared-checkout tasks for disjoint files: worktrees start from committed state and can omit current uncommitted source/catalog changes. Use native subagents where supported and appropriate. If delegation is unavailable, complete the same inventory sequentially and disclose that limitation. Do not create ordinary top-level conversations.

Give each worker this brief, substituting exact paths and entries:

> Fill only empty active target translations in these owned files: [paths]. Work from this post-extraction inventory: [entries/counts]. Read the repository-root `GLOSSARY.md`, existing locale terminology, comments, and referenced UI when meaning is ambiguous. Translate natural interface language for each locale. Preserve IDs, contexts, source messages, existing nonempty translations, headers, references, and unrelated edits. Preserve named placeholders, ICU variable names/types, select keys, exact-number branches, `other` branches, plural `#`, numbered rich-text tag indexes/pairing, literal URLs/config identifiers, and brands. Adapt plural categories to the target language. Keep tags attached to their corresponding meaning when word order changes. Use the installed PO parser/serializer; review round-trip diffs. English copying is acceptable only for genuine shared words, brands, and literals, never to conceal a gap. You own translation edits only: no extraction, seeding, global formatting, compilation, commits, or cleanup. Other workers share this checkout. Return paths, filled counts, unresolved IDs, uncertainties, and checks actually run. Finish every assigned entry or identify the blocker; do not claim global completion.

The parent tracks completion against the inventory, reviews returned diffs/counts, and resolves failures. Worker summaries alone are insufficient evidence. Retry only failed files/entries; do not rerun successful batches.

After every web worker finishes, seed once from the parent:

```sh
pnpm --filter mobile exec node scripts/seed-locales.mjs
pnpm --filter mobile exec lingui check missing --mode catalog --verbose
```

Partition remaining mobile gaps into disjoint files and apply the same workflow. Existing nonempty mobile translations remain authoritative. Finish all workers before shared commands run.

## Verify completion

First run `pnpm locales:diff` (add `--base <ref>` for a base other than `origin/main`; it compares with the merge base). It parses every web and mobile catalog and fails on lost translations (nonempty became empty) and on placeholder, ICU argument or numbered-tag mismatches in new or changed translations, allowing plural forms the target language omits; it lists changed translations and counts new untranslated and removed messages. Do not write a one-off PO comparison script. Its base is committed history, so also confirm no extraction-era translation you saved in the baseline went missing. Review newly added messages against original source. A syntactically valid message can still omit a variable, so compilation alone is insufficient. Review glossary-sensitive wording and suspicious source-identical translations.

Run every gate below and record each result. These commands are for the **whole catalog**, not changed locales or changed source files:

```sh
pnpm lingui:check
pnpm locales:diff
pnpm --filter web exec lingui check missing --mode catalog --verbose
pnpm --filter mobile exec lingui check missing --mode catalog --verbose
pnpm --filter web exec lingui compile --strict
pnpm --filter mobile exec lingui compile --strict
pnpm pdf:translations
pnpm --filter @reactive-resume/tooling test locales/section-titles.test.ts
pnpm lint:agent
pnpm format:check
git diff --check
```

`lingui:check` (both apps' `check sync`, also run in CI) proves catalogs reflect current source; an old but fully filled catalog is insufficient. `--mode catalog` proves each target catalog is filled **before fallback**. Default missing checks and `compile --strict` allow fallback and cannot replace it. Compilation adds ICU syntax/bundle validation. The tooling test must actually execute its tests; zero tests is not proof.

Compilation writes locale `.js` files. Before compiling, back up existing output bytes and record absent output paths. After checking, restore pre-existing outputs to those exact bytes and remove only files created by this invocation. Preserve outputs that were already untracked. If another process changes an output during verification, preserve its change and report the conflict instead of overwriting it. Retain generated PDF section-title and Present-label changes, since those are maintained artifacts. Inspect final status/diff against the initial baseline.

If synchronization fails, inspect source drift and re-extract from the parent after workers finish, seed again, translate new gaps, and repeat affected gates. If missing checks fail, continue filling. Repair translation-introduced syntax/placeholder errors. Report unrelated pre-existing failures separately; do not change lint policy, fallback config, source strings, or locale lists to manufacture a pass. Never pipe away exit codes or treat a partial, timed-out, or unrun check as passing.

Stop when all configured web and mobile catalogs are synchronized, all catalog-mode missing checks return zero, changed messages preserve their runtime structure, strict compilation and derived-artifact checks pass, and unrelated work remains intact. If a blocker prevents this, report exact outstanding app/locale/message counts and failed or unrun gates; do not claim completion.

## Report

Keep the handoff short: entries filled by app and locale count; final missing counts; commands/checks that passed or failed; unresolved linguistic uncertainty. State whether native-language review occurred. Mention parallelism only if workers actually ran. A clean catalog proves technical completeness, not native-language quality, browser/native behavior, deployment, or release readiness. Leave changes uncommitted unless asked otherwise.
