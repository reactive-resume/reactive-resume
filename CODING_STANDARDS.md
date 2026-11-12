# Coding standards

Review rules for Reactive Resume changes. Mechanical rules are enforced by tools, so a reviewer only confirms they ran:
`pnpm check:affected` (typecheck, tests, package boundaries, lint, format), `pnpm lingui:check`, `pnpm locales:diff`,
`pnpm check:agent-docs`. Everything below needs judgement. Apply every rule to the diff and report each violation with
its file and line.

## Parity and compatibility

- **Web and mobile parity.** A user-facing feature added, removed or changed in `apps/web` has the matching change in
  `apps/mobile` in the same work, and the reverse. Shared logic lives in a workspace package (`packages/api`,
  `packages/schema`, `packages/resume`, `packages/pdf`), not duplicated per app. The only allowed gaps are the owner's
  exceptions listed in `apps/mobile/AGENTS.md`.
- **Old clients keep working.** Installed mobile binaries stay in use for weeks, and every mobile change ships as a
  store build (there are no OTA updates). API changes are additive or backward compatible; nothing relies on clients
  updating first.
- **Migrations.** Generated SQL in `migrations/` matches the schema change, is safe on populated tables, and never
  drops or rewrites data without an explicit migration path.

## Ownership and security

- Code sits with its owner from the root `AGENTS.md` ownership map. Workflow-specific UI stays in its web or mobile
  feature; `packages/ui` holds only generic primitives; `packages/utils` only helpers no domain package owns.
- Authenticated procedures use `protectedProcedure`, and feature logic checks the caller owns every resource it reads
  or changes, including IDs nested in input. Server code reuses the shared auth resolution; no new auth path.
- No credentials, personal resume data or production identifiers in source, fixtures, logs or test artifacts.
- Unsafe OAuth-redirect and AI-base-URL flags stay off for public deployments; new code doesn't widen what they relax.

## User-facing copy

- Every user-facing string goes through Lingui macros, and catalogs are re-extracted for both apps.
- Errors are impersonal and name a recovery step: "Couldn't save your changes. Try again." Avoid "We couldn't",
  "Please", "successfully", "Oops", "Something went wrong".
- Sentence case for every element; feature names (Check, Fit, Knowledge) keep their capitals. US spelling in source
  strings. Terms: "Two-step verification", "photo", "timezone".
- Rewording an existing msgid drops its translations in every locale; the change refills them or explains why not.

## Tests

- A new or extended test protects real behaviour that no existing test reaches, and would fail on a credible
  regression. Assertions that restate constants or duplicate another test's contract are removed, not added.
- No test-only seams in production code.
- Database-backed suites must run, not skip: check the run used `pnpm test:db exec` or CI.

## Shape of the change

- The change fixes the root cause in the shared function every caller routes through, not one call site.
- No speculative abstraction: no interface with one implementation, no option nobody sets, no unused export.
- React components with explicit props use a named props type (`type FooProps = {...}`).
- A change to the resume data shape updates, in order: `packages/schema`, API DTOs (`packages/api/src/dto`),
  importers, PDF rendering, then the web and mobile forms.
- Docs that describe changed behaviour change in the same work: `docs/` guides for user-visible behaviour, agent docs
  for workflows and paths.
