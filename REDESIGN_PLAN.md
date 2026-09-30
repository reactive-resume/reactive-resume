# Reactive Resume redesign plan ("Desk & Paper")

Status: approved on 28 Sep 2026 (every §9 recommendation accepted). M0 to M12 are done (§11, §12), the PDF engine is Forme (§13), and the follow-ups and §3.10 contract steps are done (§14, 29 Sep 2026). Everything is committed locally on `redesign/forme-engine`; nothing is pushed.

**PDF engine (28 Sep 2026):** the react-pdf rendering engine (`packages/pdf`) and Semantic CSS are replaced with [Forme](https://www.formepdf.com/) in the next phase of this redesign. Until then the redesign hosts them as they are: no per-template PDF work, render-performance work or CSS-editor restyling. Engine-dependent items are marked "waits for Forme"; §14 records how each one closed.

Inputs:

- The handoff spec (`design_handoff_reactive_resume_redesign/README.md`), all 13 prototypes in `designs/` (templates and `class Component` logic), `tokens.css` and `tokens.json`.
- The UI capture atlas on `codex/ui-capture-redesign-2026-09-24` (captured 24 Sep 2026).
- This repository at `a7f182948` (28 Sep 2026). Two features postdate the atlas and are not in the spec: interview scheduling with a calendar view (#3539) and LinkedIn data-export import (#3538).

Sections: §1 maps the current stack. §2 maps the new IA onto routes. §3 covers schema changes and migrations. §4 lists components to restyle, add or replace. §5 is the capability map. §6 is the build order. §7 lists decisions and deviations from the spec. §8 covers risks. **§9 lists the questions I need answered before M1.** §10 covers verification.

Path shorthand: `B/` = `apps/web/src/routes/builder/$resumeId/`.

---

## 1. Repository map

| Concern                   | Today                                                                                                                                                                                                                                                                     | Where                                                                                                                                   | Redesign                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| App and routing           | React 19 SPA, TanStack Router file routes, Vite 8. `apps/server` (Hono) serves `index.html` and injects page metadata. No SSR.                                                                                                                                            | `apps/web/src/routes`, `apps/server/src/static/web.ts`                                                                                  | New route tree (§2). Old routes become redirect stubs.                                                                         |
| Server data               | TanStack Query + oRPC over `/api/rpc`. Router context carries `queryClient`, `orpc`, `theme`, `locale`, `session`, `flags`.                                                                                                                                               | `apps/web/src/libs/orpc`, `apps/web/src/router.tsx`                                                                                     | Reused. New procedures in §3.                                                                                                  |
| Editor draft and autosave | One zustand 5 + immer store (`useResumeStore`). Full-document `resume.update` 500 ms after the last edit, one save in flight. Remote changes arrive through `resume.updates.subscribe`. No offline detection. Last write wins.                                            | `apps/web/src/features/resume/builder/draft.ts`                                                                                         | Kept as the source of truth. Adds offline and error states, a local pending-save queue, and a session id for version grouping. |
| Undo                      | Custom stacks of 50 `structuredClone` snapshots, 500 ms global coalescing, `Mod+Z` ignored inside fields                                                                                                                                                                  | `draft.ts`, `B/-components/dock.tsx`                                                                                                    | Reworked: 200 steps, structural sharing, per-field merging, labelled structural steps, undo toast.                             |
| Versions                  | `resume_version` with a free-text English label. Newest 30 kept. Auto snapshot at most every 2 min, plus "AI edit", "Imported", "Before restore".                                                                                                                         | `packages/api/src/features/resume/service.ts`, `versions.ts`, `B/-components/version-history.tsx`                                       | Adds kind, name, session grouping, 90-day retention and read-only preview.                                                     |
| Forms                     | TanStack Form v1 via `createFormHook`, Zod 4 schemas as validators                                                                                                                                                                                                        | `apps/web/src/libs/tanstack-form.tsx`                                                                                                   | Reused. Entries validate on blur and save on change.                                                                           |
| Entry editing             | One dialog per section type, opened through a global dialog store                                                                                                                                                                                                         | `apps/web/src/dialogs/resume/sections/*`, `apps/web/src/dialogs/store.ts`                                                               | Replaced by inline entry cards. Field sets move out of the dialogs.                                                            |
| Rich text                 | TipTap 3, stores HTML. 17-button toolbar (headings, colours, alignment, lists, links, code…).                                                                                                                                                                             | `apps/web/src/components/input/rich-input.tsx`                                                                                          | Kept. Toolbar restricted to spec §5.3. Extensions stay loaded so existing formatting survives.                                 |
| Drag and drop             | motion `Reorder` for items (pointer only). dnd-kit for layout pages (pointer only).                                                                                                                                                                                       | `B/-sidebar/left/shared/items-section.tsx`, `B/-sidebar/right/sections/layout/pages.tsx`                                                | Outline uses dnd-kit sortable with `KeyboardSensor`, plus ⌥↑/⌥↓ and menu moves.                                                |
| Overlays                  | Base UI 1.8 wrappers: dialog, alert-dialog, sheet, popover, menu, context-menu, tooltip, toast. cmdk for the command palette.                                                                                                                                             | `packages/ui/src/components/*`                                                                                                          | Restyled. Missing primitives added (§4).                                                                                       |
| Shortcuts                 | `@tanstack/react-hotkeys`                                                                                                                                                                                                                                                 | `apps/web/src/routes/__root.tsx`, builder dock                                                                                          | Spec keymap (README §4.8).                                                                                                     |
| Styling                   | Tailwind 4.3, CSS-first. Achromatic shadcn tokens in oklch. `.dark` class. Theme cookie: light or dark, default dark.                                                                                                                                                     | `packages/ui/src/styles/globals.css`, `apps/web/src/libs/theme.ts`, `apps/web/src/features/theme`                                       | Desk & Paper tokens and a System theme (M1).                                                                                   |
| Icons                     | Phosphor. `@phosphor-icons/react` in about 150 app files. `@phosphor-icons/web` and `phosphor-icons-react-pdf` for icons inside resumes.                                                                                                                                  |                                                                                                                                         | App chrome moves to Material Symbols Rounded. Icons inside resumes stay Phosphor (their names are stored in resume data).      |
| Fonts                     | IBM Plex Sans Variable in the app, Manrope on the landing page, no mono font                                                                                                                                                                                              | `packages/ui/src/styles/globals.css`                                                                                                    | Newsreader, Hanken Grotesk and JetBrains Mono via fontsource.                                                                  |
| Motion                    | `motion` 13 with `LazyMotion` and `MotionConfig reducedMotion="user"`. Easing tokens exist; durations are hand-typed.                                                                                                                                                     | `apps/web/src/libs/motion.ts`                                                                                                           | Duration tokens 120/200/320 ms, one entry easing, reduced-motion override.                                                     |
| i18n                      | Lingui 6.8, 55 PO catalogs, macros. PDF section titles are extracted into a catalog by `pnpm pdf:translations`.                                                                                                                                                           | `apps/web/lingui.config.ts`, `apps/web/locales`, `tooling/locales`                                                                      | All new copy through Lingui. "Present" joins the PDF catalog.                                                                  |
| Renderer                  | `@react-pdf/renderer` 4.9 (layout 5.2, patched), 15 templates, semantic node tree used for custom CSS                                                                                                                                                                     | `packages/pdf`                                                                                                                          | Emits node keys for the page map. Sidebar side. Preview-only proposal marks.                                                   |
| Live preview              | Main-thread `pdf().toBlob()` 100 ms after edits, then pdf.js 6 paints canvases (no text layer). react-zoom-pan-pinch. Crossfade between renders.                                                                                                                          | `apps/web/src/features/resume/preview`                                                                                                  | Becomes the page canvas with an overlay layer for hover, selection, pins and markers.                                          |
| Thumbnails                | Full render, then a page-1 PNG cached per `id:updatedAt`. Template picker uses static JPGs.                                                                                                                                                                               | `apps/web/src/routes/dashboard/resumes/-components/cards/resume-thumbnail.tsx`, `apps/web/src/features/resume/preview/pdf-thumbnail.ts` | Reused for document cards and for template thumbnails of the user's own content.                                               |
| Export                    | PDF, DOCX, Markdown, JSON and Print in the browser. Signed server PDF route for MCP. Public PDF fallback.                                                                                                                                                                 | `apps/web/src/features/resume/export`, `apps/server/src/http/*`, `packages/docx`                                                        | Moves into the Share sheet.                                                                                                    |
| ATS                       | Live lint on resume JSON (21 rules with pointers to items). PDF engine (77 checks, weighted score, evidence boxes). Job-description matching. AI review.                                                                                                                  | `packages/resume/src/ats`, `packages/resume/src/ats-pdf`, `packages/api/src/features/ai`                                                | Check mode and the public checker.                                                                                             |
| AI                        | 16 providers, AES-GCM keys (`ENCRYPTION_SECRET`). Agent streams through resumable streams (needs Redis). Tools: `read_resume`, `apply_resume_patch`, `ask_user_question`, `web_search`. The builder assistant reuses `AgentChat` and applies patches directly by default. | `packages/ai`, `packages/api/src/features/{ai,agent,ai-providers,applications}`, `apps/web/src/routes/agent`                            | One assistant panel that only proposes (§3.6).                                                                                 |
| Import                    | RR v5 and v4 JSON, JSON Resume, LinkedIn ZIP, PDF (AI or local heuristics), Word (AI). Uncertain fields are not reported.                                                                                                                                                 | `packages/import`, `apps/web/src/dialogs/resume/import.tsx`                                                                             | New dialog flow with review flags.                                                                                             |
| MCP                       | 44 tools. Resume patching uses index-based JSON Pointers. `schema.json` resource.                                                                                                                                                                                         | `packages/mcp`                                                                                                                          | Updated for the date shape.                                                                                                    |
| Schemas                   | Resume data, cover letters, applications, API keys                                                                                                                                                                                                                        | `packages/schema`, `packages/db/src/schema`                                                                                             | §3.                                                                                                                            |
| Auth                      | Better Auth: email and password, verification, username, Google, GitHub, LinkedIn, custom OIDC, 2FA, passkeys, API keys, OAuth provider for MCP                                                                                                                           | `packages/auth`                                                                                                                         | Account settings page.                                                                                                         |
| Tests                     | Vitest 5 (happy-dom, Testing Library), 34 test files in `packages/ui`, 140 in `apps/web`. 24 Playwright specs, 3 of them env-gated.                                                                                                                                       | `tests/e2e/specs`                                                                                                                       | Updated in the milestone that changes each screen.                                                                             |

---

## 2. Information architecture and routes

### 2.1 New route tree

| IA node                  | Route                                                                                      | Search params                                                                                                              | Notes                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Documents (home)         | `/dashboard`                                                                               | `type` (all, resume, letter), `q`, `tags`, `sort` (edited, name, created), `view` (grid, list)                             | Replaces both libraries. A file dropped anywhere on the page imports it.                            |
| Trash                    | `/dashboard/trash`                                                                         |                                                                                                                            | Sidebar item appears only when Trash has items.                                                     |
| Applications             | `/dashboard/applications`                                                                  | `view` (list, board, insights, plus calendar if Q3g), `q`, `closed`, `applicationId` (detail sheet), `create` (Add dialog) | Keeps today's `view`, `applicationId` and `create`, so deep links and command entries keep working. |
| Settings                 | `/dashboard/settings/account`, `/dashboard/settings/preferences`, `/dashboard/settings/ai` |                                                                                                                            | `/dashboard/settings` redirects to Account on desktop and shows the three-row root on mobile.       |
| Editor, resume           | `/builder/$resumeId`                                                                       | `mode` (write, design, check), `sheet` (share, download, history), `assistant` (thread id or `new`)                        | URL unchanged.                                                                                      |
| Editor, letter           | `/builder/letter/$coverLetterId`                                                           | `mode` (write, design), `sheet`, `assistant`                                                                               | New. The static `letter` segment outranks `$resumeId`.                                              |
| Shared resume            | `/$username/$slug`                                                                         |                                                                                                                            | Adds slug redirects.                                                                                |
| Public ATS checker       | `/ats-checker`                                                                             |                                                                                                                            | Rebuilt.                                                                                            |
| Landing, auth, templates | `/`, `/auth/*`, `/templates/$`                                                             |                                                                                                                            | The landing page isn't in the spec and stays as is. Auth pages pick up the new tokens.              |

Mode, sheet and assistant live in the URL because other screens deep-link into them: the public checker's CTA opens Check, "Tailor a resume" opens the assistant, and "Open" on a sent document opens History at that version. Refreshing keeps the state.

### 2.2 Removed and redirected routes

Old route files become `beforeLoad` redirect stubs for one minor release (Q2), then get deleted.

| Old route                                                                                            | New destination                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/dashboard/resumes` (with `view`, `sort`, `tags`, `q`)                                              | `/dashboard?type=resume`, params mapped (`compact` becomes `grid`)                                      |
| `/dashboard/cover-letters`                                                                           | `/dashboard?type=letter`                                                                                |
| `/dashboard/settings/profile`, `/dashboard/settings/authentication`                                  | `/dashboard/settings/account`                                                                           |
| `/dashboard/settings/integrations`, `/dashboard/settings/api-keys`, `/dashboard/settings/job-search` | `/dashboard/settings/ai` (job-search is already a redirect)                                             |
| `/agent`                                                                                             | `/dashboard`                                                                                            |
| `/agent/new?resumeId=X`                                                                              | `/builder/X?assistant=new`, or `/dashboard` without a resume                                            |
| `/agent/$threadId`                                                                                   | The thread's working resume: `/builder/<id>?assistant=<threadId>`. `/dashboard` if that resume is gone. |

Also updated in the same milestone: command bar entries, links in `docs/` pages, any email template links, and path handling in `apps/server/src/static/web.ts`.

### 2.3 Global surfaces and shells

- **⌘K command bar** (root): Search, Go to, Run, and always a final "Ask the assistant '…'" row. Inside the editor it adds "Settings in this document".
- **New dialog** (global): opened by N, the sidebar button, the mobile center tab and ⌘K.
- **Toasts**: one region, bottom center, one toast at a time.
- **App shell** (Documents, Trash, Applications, Settings): 240 px sidebar at ≥1024, icon rail at 640–1023, bottom tab bar below 640.
- **Editor shell**: no app sidebar. Editor bar. Mobile tabs Write · Page · Design · Check (letters drop Check).
- **Public shell**: no app chrome.

---

## 3. Schema and data changes

### 3.1 Ground rules

- **Expand, migrate, verify, contract.** Every milestone's migration is additive. Old columns and fields stay and keep being written where older readers need them. Contract steps are listed in §3.10 and are not part of this plan unless you approve them separately.
- **Where changes go.** DDL through Drizzle (`packages/db/src/schema/*`, `pnpm db:generate`), applied at server startup under an advisory lock. Backfills in SQL when the logic is simple (precedent: `migrations/20260501153733_brave_amazoness`). Logic that exists only in TypeScript, such as date parsing, runs at read time instead.
- **One read path for resume JSON.** Resume data is stored in `resume.data`, `resume_version.data` and `agent_actions.snapshot_data`, and partly in `cover_letter.style`. It has no version field. Every shape change therefore goes through one read-time upgrade in the shared parser (`parseResumeData` in `packages/schema/src/resume/data.ts`), so the API, MCP, PDF and DOCX renderers, version restore and agent revert all see the same shape. The first task in M3 is an audit of readers that bypass it.
- **Write validation** (`packages/schema/src/resume/write.ts` and the published `schema.json`) accepts old and new shapes during the expand phase. `schema.json` is regenerated.

### 3.2 Structured dates (M3)

Today every date is free text: `period` on experience, education, projects, volunteer and experience roles; `date` on awards, certifications and publications (and custom sections of those types). Sample values: "March 2022 - Present", "2014 - 2018".

Every dated item gets a new field (README `Entry.dates`):

```ts
// YearMonth is "YYYY" or "YYYY-MM" (month optional, see Q5)
type ResumeDates = {
  start: YearMonth | null; // single-date items use start only
  end: YearMonth | null;
  present: boolean;
  raw?: string; // original text when it couldn't be read exactly; means "needs a look"
};
```

- **Read-time upgrade.** An item without `dates` gets one parsed from its legacy string by the existing parser (`parsePeriod` and `parseSingleDate` in `packages/resume/src/ats/period.ts`). It already handles YYYY, YYYY-MM, MM/YYYY, month names in the resume's locale and English, seasons, and "Present" in about 50 languages. The parser moves to `packages/schema` (it's pure) so the schema upgrade can call it; `packages/resume` re-exports it.
- **Outcomes.**
  - Exact parse: `start`, `end`, `present`; no `raw`.
  - Year-only parts: `"YYYY"`; no flag (Q5).
  - Lossy parse, such as "Summer 2016": the parsed year plus `raw`; flagged.
  - Unparseable: nulls plus `raw`; flagged.
  - Empty: nulls; no flag.
- **Flags.** `raw` present means "needs a look". The Write panel shows it as in screen 6.1 D2 ("We read 'Summer 2016'. Pick a month so it sorts and prints consistently."), the section row shows "n to check", and editing the field clears `raw`.
- **Printing.** A shared pure formatter in `packages/resume` uses `Intl.DateTimeFormat` month names and a localized "Present". When nothing parsed and `raw` is set, it prints `raw` verbatim, so unreadable legacy text still prints exactly as before. Switched to it: `packages/pdf/src/templates/shared/sections.tsx`, `packages/docx/src/section-renderers.ts`, `packages/resume/src/markdown.ts`, `apps/web/src/features/resume/preview/resume-accessible-text.tsx`, and the new mobile reflow page.
- **Dual write.** During the expand phase every save also writes the legacy `period` or `date` string, formatted from `dates` in the resume's locale. A rollback to an older app version, and API or MCP clients that read `period`, keep working.
- **Other consumers updated:**
  - ATS lint date rules (`packages/resume/src/ats/rules.ts`) and sorting (`section-sort.ts`).
  - Importers: JSON Resume and LinkedIn map their structured dates directly; v4 and plain text parse; the AI extraction template and `parser-system.md` ask for structured dates.
  - MCP tool metadata and prompts (`packages/mcp/src/tool-meta.ts`, `prompts.ts`), `schema.json`, agent path hints.
  - "Present" for PDFs: a Lingui message, exported by extending `tooling/locales/section-titles.ts` (`pnpm pdf:translations`).
- **Tests:** parser table (formats × locales, seasons, reversed ranges, present words, year-only); the upgrade is idempotent; dual-write round trip; formatter per locale; `raw` clears on edit; restoring a pre-migration version works; JSON Resume, LinkedIn and v4 imports produce structured dates.

### 3.3 Documents: links, trash, naming (M6)

- **`resume.application_id`** (uuid, nullable, FK to `application.id`, on delete set null) means "made for this application". It feeds Check's job match, the assistant's context and Copy for a job. It is separate from `application.resume_id` (the resume linked to, or sent with, an application), which stays: one base resume can be linked to many applications, and Insights compares tailored with base.
- **Trash.** `resume.trashed_at` and `cover_letter.trashed_at` (nullable timestamps).
  - Trashed documents are excluded from lists and search. Their public link stops (treated as not shared), their slug stays reserved, and Restore brings them back intact.
  - `resume.delete` becomes "move to Trash". A new permanent delete serves "Delete now…" and the purge job.
  - Locked documents can't be trashed, matching today's rule for delete. The menu item is disabled with the reason.
- **Daily maintenance job.** Runs at server startup and every 24 h, following the precedent of the agent run reaper in `apps/server/src/startup/checks.ts`. It is idempotent, so several instances are safe. It deletes:
  - documents trashed more than 30 days ago, through the existing hard-delete path (storage cleanup included);
  - expired slug redirects (§3.4);
  - auto versions older than 90 days (§3.5);
  - daily statistics older than 90 days (§3.9);
  - API keys revoked more than a day ago (§3.9).
- **`resume.auto_name`** (bool, default false; true for blank resumes created from New). While true, the document name follows the headline (spec 6.1 D1, "Also names the document"). Renaming by hand sets it to false.
- **Letters in the library.** `cover_letter.tags` (text[]) and `cover_letter.is_locked` (bool), so letters behave like resumes.
- **New `documents` API feature** (`packages/api/src/features/documents`):
  - `list`: UNION ALL of resumes and letters with type, title, tags, locked, trashed, timestamps and the linked application's company and role. Filters: type, trashed, tags, `q` across titles, tags and linked applications. Sort by edited, name or created.
  - `tags`, `trash`, `restore`, `purge` (confirmed), and `copyForJob` (duplicate, set `resume.application_id`, optionally set `application.resume_id`).
  - `resume.create` no longer requires a name or slug. `resume.duplicate` fields become optional (today its DTO requires them, so the fallbacks in `crud.ts` never run).

### 3.4 The slug moves to Share (M5)

- Creation no longer asks for a slug. One is generated from the name and deduplicated per user, because `resume.slug` is NOT NULL and unique per user. Links stay private by default (`is_public` already defaults to false).
- **`resume.checkSlug({ resumeId, slug })`** validates `^[a-z0-9]+(-[a-z0-9]+)*$`, checks uniqueness, and returns a suggestion. When the user's own resume holds the slug, it also returns that resume's name ("You already use this for 'Resume 2024'. Try resume-lumen."). The client calls it with a 300 ms debounce. Existing slugs that don't match the pattern keep working until changed.
- The slug is saved only once it's valid, so the old address stays live until then.
- **`resume_slug_redirect`** (id, user_id, resume_id with cascade, slug, expires_at; unique on user_id + slug). A rename stores the old slug for 30 days. `getBySlug` falls back to it and returns the current slug, and the public route redirects. Using an old slug for a real resume deletes its redirect.
- Not covered: a username change still changes every public link, because the spec doesn't ask for username redirects (§7).

### 3.5 Versions (M5; letters in M9)

- **New columns on `resume_version`:** `kind` (created, import, auto, named, before-restore, restored, ai, sent), `name` (nullable), `session_id` (nullable).
  - SQL backfill of `kind` from today's English labels: Imported → import, Manual save → auto, AI edit → ai, Before restore → before-restore, Restored version → restored.
  - The UI shows translated labels from `kind`. `label` stays for old rows.
- **Session grouping.** The editor sends a random `sessionId` per visit with `resume.update`. The server upserts one `auto` row per resume and session, refreshing it at most every 2 minutes (today's throttle). Each session becomes one entry holding its latest state.
- **Retention.** The daily job purges `auto`, `ai` and `restored` rows older than 90 days. `named`, `sent`, `import`, `created` and `before-restore` rows are kept until deleted. The count cap of 30 goes away because it would delete named versions; a high safety cap on auto rows per resume (for example 500) bounds storage.
- **New procedures:** `versions.create` (named, from "Name this version"), `versions.get` (read-only preview), `versions.rename`, `versions.delete` (named only). `restoreVersion` already saves "Before restore" first.
- **History is never empty for new documents.** Creating a resume writes a `created` version; import already writes one. Older documents without versions show "Now" plus whatever exists.
- **Letters.** `cover_letter_version` mirrors the table (M9).

### 3.6 Proposals (core in M7, assistant in M10)

- **No new table.** Check proposals are recomputed from the document. Assistant proposals are stored as tool output inside `agent_messages.ui_message`, with their status written back, so past conversations can show "3 of 4 edits accepted".
- **Shape** (README §7): `{ id, documentId, target: { sectionId, itemId?, field }, before, after, why, status, source }`. Status is pending, accepted, rejected or stale; source is assistant, check or improve. Targets use item ids rather than array indexes, so reordering doesn't break them.
- **Stale rule.** A proposal can be applied only while the current value at its target equals `before`. Otherwise it shows "Out of date" and can't be applied (spec 6.5 D4). No edit tracking is needed.
- **Accept** applies `after` through the draft store, then autosave, as one undo step. Accept all is also one step.
- **Agent change.** In-editor threads get a `propose_edits` tool (field-level before, after and why) instead of `apply_resume_patch`, and the "Review edits" auto-apply mode goes away. The unused `packages/ai/src/tools/patch-proposal.ts` is replaced. MCP and API `apply_resume_patch` stay as they are for external clients.

### 3.7 Applications (M8)

Today: `status` is saved, applied, screening, interview, offer or rejected, plus an `archived` flag. Interviews are timeline entries in `activity`. There is a follow-up date and note, uploaded resume and cover-letter PDFs, a live `resume_id` link, contacts in jsonb, tags and an AI `match_score`.

- **Stage.** Add `closed` and `closed_reason` (not-selected, withdrew, accepted-other, no-response).
  - Backfill: `rejected` becomes `closed` + `not-selected`; `archived = true` becomes `closed` with no reason.
  - `archived` stays during the expand phase. `rejected` is no longer written.
  - Insights' "reached each stage" uses the stage history already in `activity`.
- **Next step** is derived; no new columns. The earliest upcoming interview wins, otherwise the follow-up date and note. Overdue follow-ups use warn styling. Edit sets the follow-up or schedules an interview. "Add to calendar" builds an `.ics` file in the browser.
- **What you sent.**
  - New columns: `cover_letter_id` (FK, set null), `sent_resume_version_id` and `sent_cover_letter_version_id` (FK, set null), `sent_check_score` (smallint).
  - When an application reaches Applied with linked documents, the app writes `sent` versions ("Sent to {company}") and stores their ids. "Open" shows that version read-only, with a link to the latest.
  - Backfill `cover_letter_id` where exactly one letter points at the application through `source_application_id`.
- **Posting.** `requirements` (jsonb string array) filled by AI parsing. The posting text stays in `job_description` and the link in `source_url`.
- **Uploaded PDFs** stay readable under What you sent. Q3h decides whether new uploads remain possible.
- **Rollback.** Older app versions don't know `closed`, so the migration ships with a reverse script: closed + not-selected → rejected; other closed → archived.

### 3.8 Cover letters (M9)

Today `cover_letter` has name, recipient (rich-text HTML), content (HTML), `style` (a copy of a resume's basics, picture and metadata), `source_resume_id`, `source_application_id` and `revision`. Separately, resumes can hold letters as a custom section of type `cover-letter`.

- **Links.** Add `sender_linked` and `design_linked` (bool). New letters default to true: sender details and design come live from `source_resume_id`. Existing letters are migrated with false so their copied details don't change.
- **Structured recipient.** Add `recipient_name`, `recipient_company`, `letter_date` and `layout`.
  - New letters use `layout = structured`: sender header, recipient and date, a greeting derived from the name ("Dear {first name}," or "Dear hiring team,"), the body and a sign-off.
  - Existing letters get `layout = freeform`: today's recipient HTML and body render exactly as before, and their panel shows the old recipient field instead of Name and Company.
- **Versions.** `cover_letter_version` (§3.5). The `revision` optimistic-concurrency check stays.
- **Letters inside resumes:** data untouched. Their UI placement is Q3k.

### 3.9 Statistics, Check state, design metadata, API keys

- **Statistics.** `resume_statistics_daily` already exists and feeds the 30-bar chart; the daily job adds 90-day retention. The chart's accent spike and label ("Sent to Lumen · Sep 16") come from the application's sent data.
- **Check state,** stored inside resume data so it syncs, versions and exports with the document: `metadata.check = { ignored: string[], hiddenTerms: string[] }` (ignored issue keys and hidden job-match terms).
- **Design.**
  - `metadata.layout.sidebarSide`: left, right, or null for the template's default.
  - The Type, Density and Margin presets write the existing typography and page fields, so they need no new storage. Presets are calibrated so "Normal" equals today's defaults and existing resumes don't change. When current values match no preset, the control shows no selection and Advanced shows the exact values.
- **Template metadata.** Three places disagree today: the web gallery tags, the PDF template code and DOCX `TEMPLATE_CONFIGS`. `packages/schema/src/templates.ts` becomes the single source (columns, default sidebar side, header placement, ATS-safe), used by the gallery filters, the Check layout rule and DOCX.
- **API keys.**
  - Revoke sets Better Auth's `apikey.enabled` to false at once (the verifier rejects disabled keys); Undo sets it back.
  - The row is deleted when the toast closes, and the daily job removes keys disabled for more than a day.
  - Expiry options become 30 days, 90 days and Never (to verify: the plugin accepts keys without expiry).

### 3.10 Migration sequence and rollback

| Milestone | DDL                                                                                                                                   | Backfill                              | Rollback                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| M3        | None (read-time upgrade + dual write)                                                                                                 | None                                  | Older versions read the dual-written `period`/`date`        |
| M5        | `resume_version.kind`, `name`, `session_id`; `resume_slug_redirect`                                                                   | `kind` from labels                    | Additive; older versions ignore it                          |
| M6        | `resume.application_id`, `trashed_at`, `auto_name`; `cover_letter.tags`, `is_locked`, `trashed_at`                                    | None                                  | Additive; older versions would show trashed documents again |
| M8        | `application.closed_reason`, `cover_letter_id`, `sent_*`, `requirements`                                                              | `rejected`/`archived` → `closed`      | Reverse script                                              |
| M9        | `cover_letter.sender_linked`, `design_linked`, `recipient_name`, `recipient_company`, `letter_date`, `layout`; `cover_letter_version` | Existing letters → freeform, unlinked | Additive                                                    |

Contract steps (approved on 29 Sep 2026, migration `20260929063245_contract_redesign_legacy_fields`, with `rollback.sql`):

- **`period`/`date` are written from `dates` only.** The text stays in the data as printed output, rewritten from the dates on every save; an edit to the text alone is overwritten. Entries without dates (imports, older data) still get dates from their text.
- **`application.archived` is dropped.** Rows still archived are closed first. The list, bulk update, MCP tools and CSV export lose the flag; CSV import still reads it from older exports as closed.
- **`resume_version.label` is dropped.** Versions are named by `kind` and `name`.
- **`rejected` is no longer accepted as a stage.** Remaining rows and history close first; CSV import still reads it from older exports.
- Older app versions and API clients that relied on these stop working against this schema.

---

## 4. Components: restyle, add or replace

Rule from the spec: keep a library where the repo already has one, and restyle it.

### 4.1 `packages/ui` (generic primitives)

| Component                                                                                           | Plan                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button                                                                                              | **Restyle.** Primary, secondary, ghost and danger; sizes sm 28, md 36, touch 44; loading (14 px spinner plus a present-participle label, `aria-busy`). |
| Icon button                                                                                         | **Add** (thin wrapper). Required `aria-label`, tooltip with the shortcut.                                                                              |
| Split button                                                                                        | **Restyle** `button-group` (Download PDF ▾).                                                                                                           |
| Input, textarea, input-group                                                                        | **Restyle.** `input-group` becomes the prefixed input with a status icon (address, username).                                                          |
| Select                                                                                              | **Add** a styled native select, as specified. Combobox stays for long searchable lists (fonts, languages).                                             |
| Checkbox, switch, slider                                                                            | **Restyle.** Switch rows make the whole row the `role="switch"` control.                                                                               |
| Radio group, radio card                                                                             | **Add** on Base UI Radio.                                                                                                                              |
| Segmented control                                                                                   | **Add** on Base UI ToggleGroup.                                                                                                                        |
| Tabs                                                                                                | **Restyle,** plus an underline variant with mono counts.                                                                                               |
| Menu, context menu, popover, tooltip                                                                | **Restyle** (radius 12, e2, enter motion from the trigger).                                                                                            |
| Dialog, alert dialog                                                                                | **Restyle** (radius 16, scale from 0.98; alert dialogs name what's kept on cancel).                                                                    |
| Sheet                                                                                               | **Restyle.** Side sheet (440/480/400 widths, 0.18 scrim) and bottom sheet (18 px radius, grabber, half and full stops).                                |
| Toast                                                                                               | **Restyle.** One at a time, bottom center, ink background, Undo action, 5–6 s, polite live region.                                                     |
| Alert, empty, skeleton, spinner, badge, kbd, avatar, label, separator, scroll-area, form, otp-field | **Restyle.** The spinner becomes the CSS spinner.                                                                                                      |
| Step list with progress                                                                             | **Add** (labelled steps plus a 4 px bar) for import, the ATS checker and Fit.                                                                          |
| File drop zone                                                                                      | **Add** (default, dragging, error) plus the page-wide overlay variant.                                                                                 |
| Command                                                                                             | **Restyle** cmdk into the 560 px command bar.                                                                                                          |
| Icon                                                                                                | **Add** (Material Symbols Rounded).                                                                                                                    |
| Structured date input                                                                               | **Add.** Two month-year fields, an en dash and a Present switch. Labels come in as props because `packages/ui` can't use Lingui.                       |
| Sidebar (shadcn)                                                                                    | **Replace** with the web app shell. Removed from `packages/ui` if nothing else uses it.                                                                |
| Resizable                                                                                           | No longer used by the builder or the agent page. **Removed** if unused.                                                                                |
| Accordion                                                                                           | Used for collapsible rows, or **replaced** by a simple disclosure where lighter.                                                                       |

### 4.2 `apps/web` (feature components)

| Today                                                                                                             | Plan                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Dashboard layout, sidebar, header                                                                                 | **Replace** with the app shell (sidebar, icon rail, bottom tabs).                                                      |
| Resume library (grid, list, compact, cards, menus) and cover-letter library                                       | **Replace** with Documents. Cards reuse the thumbnail pipeline; menus reuse the logic in `use-resume-menu-actions.ts`. |
| Create, import and edit-details dialogs                                                                           | **Replace** with the New dialog, inline rename, Tags… and the Share address.                                           |
| Builder shell (three resizable panels, two icon rails, dock, header, mobile shell)                                | **Replace** with the editor shell: editor bar, mode panel, page canvas, zoom bar, overlay layer.                       |
| Left sidebar sections and the item dialogs                                                                        | **Replace** with the outline, Basics card and entry cards. Field sets are reused from the dialog code.                 |
| Right sidebar (template, layout, typography, design, page, custom styles)                                         | **Replace** with Design mode. The CodeMirror stylesheet editor is kept and restyled inside Advanced.                   |
| Sharing, statistics, export sections, download dialog, version-history dropdown                                   | **Replace** with the Share & export sheet.                                                                             |
| Builder ATS section and public checker report                                                                     | **Replace** with Check mode and the rebuilt public page. The ATS engines stay.                                         |
| Notes and Information sections                                                                                    | Move into the document menu.                                                                                           |
| Builder assistant sheet and the agent pages (`AgentChat`, patch approval cards, thread sidebar, new-thread setup) | **Replace** with the assistant panel. The streaming transport, question-card logic and attachment helpers are reused.  |
| Rich input                                                                                                        | **Restyle,** restrict the toolbar, add Improve (M10).                                                                  |
| Chip input                                                                                                        | **Restyle** as the tag input.                                                                                          |
| Picture section                                                                                                   | Becomes the photo popover in Basics.                                                                                   |
| Applications board, insights, calendar, CSV sheets                                                                | **Restyle.**                                                                                                           |
| Applications table, form sheet, detail sheet, copilot                                                             | **Replace** with the grouped list, Add dialog, rebuilt detail sheet and the assistant.                                 |
| Cover-letter editor dialog                                                                                        | **Replace** with the editor shell for letters.                                                                         |
| Six settings pages                                                                                                | **Replace** with three. Password, 2FA and passkey dialogs are reused and restyled.                                     |
| Public resume page                                                                                                | **Rebuild** (desktop bar and canvas, mobile reflow).                                                                   |
| Command palette                                                                                                   | **Rebuild** its groups. cmdk and the page-stack store stay.                                                            |
| Theme toggle and combobox                                                                                         | **Replace** with Appearance tiles and ⌘K entries.                                                                      |

---

## 5. Capability map

Every capability in today's app, and where it lives after the redesign.

- **Placed:** the spec places it.
- **Proposed:** the spec is silent; this is my placement (approve in bulk with Q3).
- **Decide:** needs your call (Q3 letter given).
- **Removed:** the spec removes it deliberately.

### 5.1 Global shell

| Capability today                                                                          | After                                                                                                                   | Status   |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| Main nav: Resumes, Applications, Cover Letters, Agents, ATS Checker, six settings pages   | Documents and Applications. Settings from the avatar. Agents → Assistant. ATS Checker → Check mode (public page stays). | Placed   |
| Collapsible sidebar (`Mod+B`)                                                             | Fixed 240 px sidebar, icon rail on tablet. `Mod+B` removed.                                                             | Proposed |
| User menu: language, theme, sign out                                                      | Preferences and ⌘K. Sign out at the bottom of Settings → Account and on the mobile Account root.                        | Proposed |
| Command palette: search resumes, applications and threads; create; theme; language; go to | ⌘K: Search, Go to, Run, Ask. Threads appear as past conversations.                                                      | Placed   |
| Shortcuts `Mod+K`, `Mod+Z`, `Mod+Shift+Z`, `Ctrl+Y`, `Mod+0`, `Mod+S`                     | Spec keymap. `Mod+0` fits the page. `Mod+S` keeps its "saved automatically" toast.                                      | Proposed |
| Light and Dark themes                                                                     | Light, Dark and System                                                                                                  | Placed   |
| 55 languages, right-to-left                                                               | Kept. `DirectionProvider` gets its missing `direction`, so Base UI follows RTL.                                         | Placed   |
| Donation toast                                                                            | Q3n                                                                                                                     | Decide   |

### 5.2 Documents and New

| Capability today                                                                                 | After                                                                                                                                                              | Status            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Grid, list and compact views                                                                     | Grid and list                                                                                                                                                      | Removed (compact) |
| Sort, tag filter, search on name and slug                                                        | Kept. Search also covers linked applications.                                                                                                                      | Placed            |
| Thumbnails, lock overlay                                                                         | Kept (lock badge)                                                                                                                                                  | Placed            |
| Edit details: name, slug, tags                                                                   | Inline rename, Tags… in the card menu, address in Share                                                                                                            | Placed            |
| Duplicate; lock with confirmation; permanent delete with confirmation                            | Duplicate; lock without confirmation; Move to Trash with undo; Trash with Restore and Delete now                                                                   | Placed            |
| Create (name, slug, tags); create a sample resume                                                | New → Start blank; Try with a sample resume                                                                                                                        | Placed            |
| Import RR JSON, RR v4, JSON Resume, LinkedIn ZIP, PDF, Word; manual format override              | New → Import, same formats (LinkedIn ZIP accepted although the tile copy doesn't name it). Auto-detect, with a "Read as…" choice only when detection is ambiguous. | Proposed          |
| Letters library: search, paging, create with template, JSON import and export, duplicate, delete | Letters tab in Documents. Design is inherited from the resume. JSON import through New → Import, JSON export through Share → Download.                             | Proposed          |
| Copying a letter embedded in a resume into the library                                           | Q3k                                                                                                                                                                | Decide            |

### 5.3 Editor · Write

| Capability today                                                                                                                                      | After                                                                                                                                          | Status   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Picture: upload with crop, URL, show/hide, delete, fit, size, rotation, aspect ratio, radius, border, shadow                                          | Photo popover in Basics, all options                                                                                                           | Placed   |
| Basics fields and custom fields (icon, text, link)                                                                                                    | Basics card. Custom fields as "Add field" under Website.                                                                                       | Proposed |
| Summary                                                                                                                                               | Summary row with guidance and Improve                                                                                                          | Placed   |
| 12 item sections                                                                                                                                      | The outline lists sections in use; Add section lists the rest. Interests is missing from the spec's list and is added.                         | Proposed |
| Section menu: add item, sort by date, show/hide, hide heading, rename, keyword layout, columns 1–6, icon, reset, keep together, start on new page     | Eye on the row. Everything else in a row ⋯ menu (the mobile spec already has a row menu). Reset shows an undo toast instead of a confirmation. | Proposed |
| Item actions: drag, hide, duplicate, move to another section, a new section or a new page, delete                                                     | Drag and ⌥↑/⌥↓. Entry ⋯ menu: Hide from page, Duplicate, Move to…, Delete (undo).                                                              | Proposed |
| Custom sections (14 types, including summary and cover letter)                                                                                        | Add section → Custom section → type                                                                                                            | Proposed |
| Role progression                                                                                                                                      | Add role                                                                                                                                       | Placed   |
| Show link in title                                                                                                                                    | Checkbox under the link field (spec Design System forms)                                                                                       | Placed   |
| Type-specific fields: skill level, proficiency, keywords, icon and colour; language level and fluency; profile icon; reference and publication fields | Kept. Secondary fields (level, icon, colour) sit under "More options" in the entry card.                                                       | Proposed |
| Hidden-sections list with Show                                                                                                                        | Hidden sections stay in the outline (strikethrough, eye)                                                                                       | Placed   |
| Locked banner with "Enable editing"                                                                                                                   | Read-only panel with "Locked · Unlock"                                                                                                         | Proposed |
| Rich text: headings, underline, strike, code, colours, highlight, alignment, indent, rule                                                             | Restricted toolbar. Existing formatting is preserved and removable with Clear formatting.                                                      | Placed   |
| Fullscreen rich-text editor                                                                                                                           | Q3m                                                                                                                                            | Decide   |
| Multi-page layout: add and delete pages, full width per page, main and sidebar per page, sidebar width                                                | Q3f                                                                                                                                            | Decide   |
| Undo, redo, zoom, pan, pinch, double-click zoom                                                                                                       | Undo in the bar; zoom bar 60–150 %                                                                                                             | Placed   |
| Page stacking toggle                                                                                                                                  | Q3m                                                                                                                                            | Decide   |
| Copy public URL and Open AI agent in the dock                                                                                                         | Share; ⌘J assistant                                                                                                                            | Placed   |
| Cross-tab sync and "updated elsewhere" notice                                                                                                         | Kept                                                                                                                                           | Proposed |

### 5.4 Editor · Design

| Capability today                                                                                        | After                                                                              | Status            |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------- |
| Template gallery (15, static sample images)                                                             | Thumbnails of the user's content, hover preview                                    | Placed            |
| Any of about 500 font families for body and heading, weights, size, line height, German hyphenation     | Five pairings, size, density. The rest per Q3b.                                    | Decide            |
| 22 swatches; primary, text and background colours                                                       | Eight accents plus a custom hex with contrast check. Text and background per Q3c.  | Decide            |
| Level indicator style and icon                                                                          | Q3d                                                                                | Decide            |
| Page: language, A4/Letter/free-form, margins, gaps, hide link underline, hide icons, hide section icons | Page group. Gaps and hide-section-icons in Advanced (Proposed). Free-form per Q3e. | Proposed / Decide |
| Custom CSS editor                                                                                       | Advanced                                                                           | Placed            |
| Notes; Information (docs, source, bug report, translations, sponsors, donate)                           | Document menu                                                                      | Placed            |
| Export panel                                                                                            | Share → Download                                                                   | Placed            |

### 5.5 Editor · Check

| Capability today                        | After                                                    | Status   |
| --------------------------------------- | -------------------------------------------------------- | -------- |
| Live lint with jump to item             | Issues pinned to their lines                             | Placed   |
| Optional job description                | Job match from the linked application; paste as fallback | Placed   |
| Deep check (PDF report and AI review)   | Deep check with a toast; Writing tab                     | Placed   |
| Choosing the provider for the AI review | Model chip in the Writing tab's disclosure ("Change")    | Proposed |

### 5.6 Share & export

| Capability today                                                                                | After                                                                                                                | Status   |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| PDF, DOCX, Markdown and JSON downloads; resume and letter tabs                                  | Download tab                                                                                                         | Placed   |
| Letter download "Include resume header"                                                         | Checkbox in the Download tab for letters                                                                             | Proposed |
| Print                                                                                           | Document menu → Print (⌘P becomes Download PDF)                                                                      | Proposed |
| Public access, download buttons, copy URL                                                       | Link tab                                                                                                             | Placed   |
| Password protection                                                                             | Q3a                                                                                                                  | Decide   |
| Statistics: views, downloads, sparkline, change vs previous 30 days, last viewed and downloaded | Views and downloads (30 bars, time since last view). "Change vs previous 30 days" and "last downloaded" are dropped. | Proposed |
| Version history (automatic, restore with confirmation)                                          | History tab: named versions, preview, restore without confirmation (it's undoable)                                   | Placed   |

### 5.7 Assistant

| Capability today                                                       | After                                                                | Status               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| Agents page: thread list, archive, delete                              | Past conversations grouped by document; delete kept; archive per Q3j | Decide               |
| Model and resume pickers per thread                                    | Model chip; document inferred                                        | Placed               |
| Working on an AI copy or a blank draft                                 | Q3j                                                                  | Decide               |
| Attachments, web-search sources, token counts, copy transcript or JSON | Q3j                                                                  | Decide               |
| "Review edits" toggle and auto-apply                                   | Always proposals                                                     | Removed (auto-apply) |
| Restoring an applied edit                                              | ⌘Z and History                                                       | Placed               |
| Agent questions (options or your own words)                            | Clarifying question card                                             | Placed               |
| Builder assistant sheet                                                | Assistant panel                                                      | Placed               |
| ATS AI review                                                          | Check → Writing                                                      | Placed               |
| Application copilot: tailor resume, draft cover letter                 | Tailor a resume; Write a letter with Draft from the posting          | Placed               |
| Application copilot: fit score, follow-up draft                        | Q3i                                                                  | Decide               |

### 5.8 Applications

| Capability today                                                                                                            | After                                                                                                           | Status            |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| Board, table, insights views                                                                                                | Board, grouped List, Insights                                                                                   | Placed            |
| Calendar view and interview scheduling (#3539, not in the atlas)                                                            | Q3g                                                                                                             | Decide            |
| Search, archived toggle                                                                                                     | Search, Show closed                                                                                             | Placed            |
| Tag filter, sort (updated, applied, company, role), table bulk actions (move stage, tag, archive, delete)                   | Q3h                                                                                                             | Decide            |
| CSV import (upload, paste, sample, preview) and export (current filters or all, date range)                                 | Import/export icon; column matching confirmed before saving; export options kept                                | Placed / Proposed |
| Board drag; card menu (edit, move, archive, delete)                                                                         | Drag plus a Move to… menu; Close…; Delete in ⋯                                                                  | Placed            |
| Add/edit form: job description autofill, company, role, location, salary, source, stage, link, stage date, follow-up, notes | Add dialog from a pasted link or posting; the other fields in the detail sheet                                  | Placed            |
| Resume link or PDF upload; cover-letter PDF upload; tags                                                                    | Links placed. Uploads and tags per Q3h.                                                                         | Placed / Decide   |
| Detail: stage bar and move, notes, documents sent, interviews list and schedule, follow-up, mark rejected, archive, delete  | Stepper, Next step (interviews and follow-up), What you sent, Notes (autosave), Close application…, Delete in ⋯ | Placed            |
| Contacts (several per application)                                                                                          | Contact cell shows the primary contact; the full list opens from it                                             | Proposed          |
| Timeline: add notes, edit notes, edit entry dates, delete entries                                                           | Activity, with each row's ⋯ menu for edit and delete                                                            | Proposed          |
| Interview dialog (type, date and time, duration, location, notes)                                                           | "Schedule interview" from Next step → Edit; adds `.ics`                                                         | Proposed          |
| Insights: tiles, pipeline chart with PNG export, weekly chart, by-source chart                                              | Funnel, heard back, median days, tailored vs base. Extras per Q3p.                                              | Decide            |

### 5.9 Settings

| Capability today                                                                      | After                                                                                                          | Status   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- |
| Profile: name, username, email change with confirmation, resend verification          | Account → Profile, plus photo upload (new)                                                                     | Placed   |
| Preferences: theme, language                                                          | Appearance tiles including System, Language, Motion note                                                       | Placed   |
| Password, 2FA with backup codes                                                       | Sign-in & security                                                                                             | Placed   |
| Passkeys; Google, GitHub, LinkedIn and custom OIDC sign-in                            | Q3o                                                                                                            | Decide   |
| API keys: create with 1, 3, 6 or 12-month expiry; shown once; delete                  | 30 days, 90 days or Never; shown once; revoke with undo                                                        | Placed   |
| Integrations: 16 providers, advanced options, enable switch, test, edit model, delete | Provider rows (Test with latency, Edit). Add provider lists all 16. Enable switch and delete live inside Edit. | Proposed |
| Account: export data (profile and resumes as JSON); delete by typing "delete"         | Export everything (zip with documents and applications); Delete account alert dialog with counts               | Placed   |

### 5.10 Public pages and auth

| Capability today                                                                                              | After                                                   | Status   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| Public resume: PDF viewer, download if allowed, views counted, OG tags, "Build your own resume"               | New desktop page and mobile reflow; footer credit       | Placed   |
| Password gate for public resumes                                                                              | Q3a                                                     | Decide   |
| `ROOT_RESUME_ID` mode, `/templates/$`                                                                         | Unchanged (the root mode uses the new public page)      | Proposed |
| Landing page                                                                                                  | Unchanged (not in the spec)                             | Proposed |
| Auth pages: passkey autofill, social sign-in, 2FA, backup codes, OAuth consent, error page, instance switches | Restyled through tokens only (not designed in the spec) | Proposed |
| Public ATS checker: in-browser PDF check, job description, categories, coverage                               | Rebuilt with the parser view and the fix CTA            | Placed   |
| Public checker AI review for signed-in users                                                                  | Q3l                                                     | Decide   |
| MCP and API                                                                                                   | Unchanged apart from dates                              | Placed   |

---

## 6. Build order

This follows README §8 with two adjustments:

1. **The proposal core moves from step 10 to Check (M7).** Check's rewrite fixes need it; the assistant then builds its UI on top.
2. **Responsive work happens in every milestone.** Each milestone ships the tablet and mobile frames from its own screen spec, so the three breakpoints can be verified per milestone as the kickoff asks. M12 is the cross-screen responsive and accessibility audit that README §8 puts last.

Sizes are relative (S, M, L, XL). XL milestones split into the listed PRs. After each milestone I'll summarise what changed and every difference from the spec, with the reason.

### M0 · Preparation and spikes (S)

- Branch strategy per Q1.
- Handoff folder at the repo root plus a `.gitignore` line. Otherwise Oxlint and knip inspect it, and `pnpm check` rewrites its JavaScript with Oxfmt.
- Load the TanStack Router skills (`router-core`, `navigation`, `search-params`, `auth-and-guards`) before route work, per `CLAUDE.md`.
- **Spike A, render cost.** Add performance marks around `createResumePdfBlob`. Measure p50 and p95 for the sample resume and for 2-page and 4-page resumes on a mid-range laptop. The result sets the typing debounce and decides whether rendering moves to a Web Worker before M3 and M4.
- **Spike B, page map.** Emit `data-rr-key` on section and item containers in the `packages/pdf` primitives and `SectionShell`. Read the layout tree that `Document.onRender` receives, sum parent offsets and draw boxes over the canvas for Onyx, Azurill and Bronzor. Confirm that exported PDFs don't carry the keys, or that carrying them is harmless.
- Output: a short note appended to this plan.

### M1 · Tokens, theming, primitives (L)

PRs: tokens, theme and fonts; icons; primitives.

- **Tokens** from `tokens.css` into `packages/ui/src/styles/globals.css`: light on `:root`, dark on `.dark` (keeping the 57 `dark:` uses working), `color-scheme`, and the reduced-motion override. Tailwind theme variables expose colours (`bg`, `surface`, `raised`, `sunken`, `line`, `line-2`, `ink`, `ink-2`, `ink-3`, accent, danger, warn, info, stage colours, `paper`), radii, shadows e1–e3, named durations (quick, standard, emphasized), the entry easing and the three font families. `apps/web/src/libs/motion.ts` mirrors durations and easing for Motion.
- **Compatibility aliases.** The old shadcn names point at the new tokens (background → bg, foreground → ink, primary → accent, muted → sunken, muted-foreground → ink-3, border → line, input → line-2, ring → accent, destructive → danger, card and popover → surface and raised). Unconverted screens stay usable; M12 removes the aliases.
- **Hard-coded colours.** About 100 amber, rose, emerald and sky classes become warn, danger, accent and info tokens.
- **Theme.** Add System (cookie value `system` plus a `matchMedia` listener), a no-flash script in `index.html` (today it hard-codes `class="dark"` and a `#09090b` loader), and manifest colours.
- **Fonts.** `@fontsource-variable/newsreader`, `@fontsource-variable/hanken-grotesk` and `@fontsource-variable/jetbrains-mono` in `packages/ui`. IBM Plex leaves the UI; email templates keep it. The Insights PNG export's font lookup is updated.
- **Icons.** `Icon` in `packages/ui` renders a self-hosted Material Symbols Rounded subset (weight 300, FILL 0–1, optical size 20–24). A `tooling/` script builds the subset from the icon names used in code through Google Fonts' `icon_names` parameter, and the woff2 is checked in. Icons are `aria-hidden` with `translate="no"`, so ligature text never reaches accessible names or test selectors. Screens switch from Phosphor as they're rebuilt; icons inside resumes stay Phosphor.
- **Primitives** per §4.1, each with default, hover, focus-visible (`--focus` ring), disabled and loading states, plus touch sizes. Toast shows one at a time with an Undo action.
- **RTL fix.** `DirectionProvider` in `__root.tsx` gets its `direction`.
- **Docs.** Rewrite `DESIGN.md` for Desk & Paper. Add new terms to `GLOSSARY.md`: Documents, Trash, Write, Design, Check, Share sheet, Assistant, proposed edit, Next step, Closed, version.
- **Tests.** Update the 34 `packages/ui` test files. Add tests for the segmented control, radio group, file drop zone, step list, icon (`aria-hidden`) and the toast's replace behaviour.
- **Done when** every existing screen renders in light and dark with the new tokens and no contrast regressions (ink-3 as the minimum for text), all primitives show their states, and reduced motion collapses durations.

### M2 · Editor shell (XL)

PRs: shell, bar and modes; save states and undo; page canvas and page map.

- **Shell** at `/builder/$resumeId`:
  - Editor bar: back, name and save status; the Write, Design and Check segmented control with the Check badge; undo, history, assistant, Share (with the live dot) and the Download PDF split button.
  - Grid of a 400 px panel and the canvas. The canvas has the sunken background, the caption, the page shadow and the zoom bar (−, Fit, +, page count, 60–150 %).
  - Tablet: a 380 px drawer, pinnable in landscape. Mobile: the four editor tabs.
- **No gaps during migration.** Until their milestones land, modes host today's panels: Write shows the current left sidebar, Design the current design sections, Check the current ATS section, and Share the current download dialog and sharing sections.
- **Replaces** the react-resizable-panels shell, both icon rails, the dock, the header and the mobile shell.
- **Save status:** Saving…, Saved, "Offline · saved on this device" and "Not saved · Retry".
  - Offline detection from `navigator.onLine` and network failures.
  - Unsent changes are stored per resume in IndexedDB (or localStorage) and replayed on reconnect. Download and Share are disabled while offline.
  - Leaving the editor with unsent changes keeps today's wait-then-block behaviour, now with Retry.
- **Undo.**
  - 200 steps holding immer's immutable trees instead of `structuredClone` copies.
  - Consecutive edits to the same field within 1 s merge into one step. Each structural action is its own step, with a label for the toast.
  - A design change, template switch, Fit or AI accept is one step each. Locked documents block undo as today.
- **Page map** (from Spike B). Node keys become absolute boxes per page. An overlay layer inside the zoom container shows the hover tint and the selected block's outline with its "Editing" tag. A click selects `{sectionId, itemId}`, and focusing a field outlines its block. One selection store serves the panel and the page.
- **Keymap:** 1, 2, 3 outside fields; ⌘Z and ⇧⌘Z; Esc; ⌘P; ⌘⇧S; ⌘⇧E. ⌘J is wired in M10.
- **Document menu** on the document name: Rename, Duplicate, Lock/Unlock, Notes, Information, Print, Move to Trash.
- **Tests:** undo depth, per-field merging, structural steps, redo cleared by a new edit, lock; the save state machine (offline → queued → replayed, error → retry); page-map box maths from a fixture layout tree; key decoding.
- **E2E:** update `builder-save-navigation`, `lock-resume`, `template-switch`, `preview-direction`, `section-recovery`.
- **Done when** the whole current builder works inside the new shell at three breakpoints and click-to-select works on all 15 templates.

### M3 · Write (XL)

PRs: outline, Basics and entries; structured dates; rich text and states.

- **Basics card:** collapsible, initials avatar, photo row with the picture popover; Full name, Headline, Email, Phone, Location, Website, plus custom fields.
- **Outline:**
  - "SECTIONS · PRINT ORDER" eyebrow with the drag hint.
  - Outline rows: handle, title button, count, eye, chevron and a ⋯ menu. Page dividers appear when there is more than one page.
  - Entry cards: collapsed shows the title and "company · location · dates"; expanded shows fields in a two-column grid. One entry open at a time. Delete with an undo toast; ⋯ menu.
  - "+ Add {type}".
  - Add section: a two-column menu of unused types, including Interests; Custom section asks for a type. It creates the section with one draft entry and focuses its first field.
  - The footnote.
- **Field sets** come from today's dialog forms (`apps/web/src/dialogs/resume/sections/*`) and move to `apps/web/src/features/resume/editor/entries/*`. The dialogs and their registry are deleted.
- **Structured dates** (§3.2) with the structured date input and the D2 review flags.
- **Drafts.** An entry without a title shows "Untitled" and "Draft · not printed". The renderer already skips items without a primary title (`packages/pdf/src/templates/shared/filtering.ts`).
- **Rich text.** Toolbar shown on focus only: Bold, Italic, Link, then Bulleted list, Numbered list, Clear formatting. Buttons prevent `mousedown` so the field keeps focus. Markdown shortcuts, and a footer with "Markdown shortcuts on" and the character count. Summary guidance: "2–3 sentences reads best". Improve arrives in M10.
- **Validation** after the first blur, with messages that say how to fix it (email, URL).
- **Page and panel.** Clicking a block expands its entry, collapses Basics and scrolls the panel so the entry sits 60 px from the top (instant with reduced motion). Esc closes the Add menu first, then the entry.
- **Reorder.** dnd-kit sortable with the keyboard sensor for sections and entries, ⌥↑/⌥↓, and Move up/down in menus. Drops write `metadata.layout.pages[*].main` and `sidebar`. No drag starts inside inputs.
- **States** D1–D4; tablet drawer; mobile C1–C3. On mobile the entry pushes in full screen, the toolbar docks over the keyboard with Done, and tapping the page shows the floating "Edit entry | Improve" bar (Improve hidden until M10).
- **Tests:** everything in §3.2; Add section creates a focused draft; drafts don't print; keyboard moves in the outline; flags clear on edit; undoing an entry delete.
- **E2E:** update `section-editing`, `section-date-sorting`, `picture-upload`, `section-recovery`, `hyphenation`. Add an inline-editing and click-to-select spec.

### M4 · Design (L/XL)

PRs: gallery and preview; type, colour, page and Advanced; overflow and Fit.

- **Group nav:** sticky Template · Type · Color · Page · Advanced, with groups divided by rules.
- **Template:**
  - Filter chips All, One column, Two columns, ATS-safe, with "n of 15 shown".
  - A two-column grid of thumbnails rendered from the user's data in their font and colour. Lazy, cached by template and data hash, rendered at idle time, with stable placeholders. The selected card has an accent ring and a check.
  - Hover or keyboard focus previews the template on the page, reusing the cached render, with the dark "Previewing X · click to apply" chip. Leaving the grid or pressing Esc restores the original.
  - Click applies with a 200 ms cross-fade and an undo toast.
- **Sidebar sub-panel** for two-column templates: Left/Right (template work, §8), width 26–42 % (exact 10–50 in Advanced), section chips, and the ATS warning. The matching Check issue comes in M7.
- **Type:** five pairings (all families are already in `packages/fonts`), size 9–12.5 pt, density Compact, Normal, Roomy.
- **Color:** eight presets and a hex field showing its contrast ratio against white. Below 4.5:1 it warns and offers "Use a darker shade" (same hue, lower lightness until the ratio is at least 4.6:1).
- **Page:** Letter/A4, language (section titles and date words), margins, "Icons in contact line", "Underline links".
- **Advanced:** exact values, custom CSS (the existing CodeMirror editor, restyled; Check re-runs), Reset to template defaults, plus the Q3 items.
- **Overflow.**
  - Detected from the page map when physical pages exceed authored pages. Shows the dashed "Page 2" line and the chip "Runs onto page 2 by about N lines".
  - Fit to one page tightens density, then margins, then size in 0.5 pt steps, never below 9 pt, re-rendering and re-measuring after each step.
  - The whole Fit is one undo step, with the spec's success and failure toasts.
- **Mobile and tablet.** Mobile uses a bottom sheet (half and full) with Template, Type, Color and Page tabs, a horizontal template strip and 48 px swatches. Tablet uses press-and-hold to preview.
- **Tests:** Fit step order and the 9 pt floor (a pure function with an injected measure); contrast and darkening; preset mapping (Normal equals today's defaults); template metadata consistency between the gallery, PDF and DOCX.
- **E2E:** update `template-switch`, `hyphenation`, `preview-direction`.

### M5 · Share & export, History (L)

PRs: sheet, Link and Download; versions, History and redirects.

- **Sheet.** 440 px from the right; a bottom sheet on mobile. Tabs Link, Download, History. The canvas shifts 120 px left. Share opens Link, ▾ opens Download and the clock opens History; ⌘⇧S and ⌘⇧E too.
- **Link tab:**
  - Public switch card; address with the live check and suggestion (§3.4); Copy, then "Copied" for 2 s.
  - "Visitors can download the PDF"; Open public page; QR code (`qrcode.react` is already a dependency); password per Q3a.
  - Views and downloads: three Newsreader numerals and the 30-bar chart, or the explanation when the link is off.
  - Mobile adds "Share via…" (Web Share API) next to Copy link.
- **Download tab:**
  - Format radio cards with the spec copy and "Best for applying".
  - File name with the mono extension (default First-Last-Resume; strips `\/:*?"<>|`).
  - The letter checkbox (M9) and the non-blocking Check note (M7).
  - Progress inside the 44 px button; on failure an alert, "Try again" and PDF as the fallback.
- **History tab:**
  - "Name this version"; a timeline of Now, sessions, named versions and Imported or Created.
  - Selecting a version previews it read-only on the page with the dark banner; Restore (after saving "Before restore") or Back to now.
- **Data:** §3.4 and §3.5.
- **Removes** the header download dialog, the sharing, statistics and export sections, and the version-history dropdown.
- **Tests:** slug pattern, suggestion and redirect lifetime; file-name sanitising; version kinds, session upsert and retention (API).
- **E2E:** update `public-sharing`, `sharing-password`, `public-download-preference`, `resume-views`, `json-export-import`.

### M6 · Documents & New (L)

PRs: app shell, Documents and Trash; New dialog.

- **App shell.**
  - Sidebar: the "Rr" placeholder logo (to be replaced with the project logo, spec §10), the ⌘K button, Documents and Applications with counts, Trash with its count, New with the N hint, and the avatar row that opens Settings.
  - Tablet icon rail. Mobile bottom tabs Documents · Applications · New · Account.
- **Documents page:**
  - Newsreader title; tabs with counts; search (/); sort; grid/list; tag chips.
  - Cards: real thumbnail, title, "Resume · Edited 2h ago", application line, ⋯, lock badge, 2 px hover lift. A "New" badge until opened (remembered per device).
  - List table: Name, Type, Application, Edited, ⋯.
  - Page-wide drop overlay; states D1–D4; first run ("Let's start with what you have", with Choose a file as the primary action).
- **Card menu** (grid, list and long-press): Open, Rename (inline), Duplicate, Copy for a job… or Link to application…, Tags…, Lock/Unlock, Move to Trash (undo toast).
- **Trash:** back link, retention note, "n days left", Restore, and "Delete now…" behind an alert dialog.
- **New dialog** (640 px; bottom sheet on mobile):
  - Choose: Import, Copy a resume for a job, Start blank, and the footer links "New cover letter instead" and "Try with a sample resume".
  - Importing: file row with Cancel, three labelled steps with notes, progress bar, then the result with the flagged-field count and Open in editor / Stay here.
  - Copy for a job: source resumes as radio rows, application chips or "No job yet", the suggested name, Create and open.
  - Start blank opens Write on the name field.
- **Data:** §3.3, the `documents` API and the daily job. Letters open in today's letter dialog until M9.
- **Redirects** for the old library routes; command bar entries updated.
- **Tests:** document list filters, sort and search (API); trash, restore and purge; Copy for a job links; auto name; import step state machine.
- **E2E:** update `dashboard-lifecycle`, `cover-letter-library`, `json-export-import`. Add a trash-and-restore spec.

### M7 · Check (L)

PRs: issues, score and pins; proposal core; job match, Writing and parser view.

- **Header:** score ring (live checks, §7), verdict and the limit statement; tabs Issues (n), Job match (x/y), Writing.
- **Issues tab:**
  - Numbered cards pinned to their lines. Warn pins in the margin and wavy underlines are drawn from item boxes; PDF-engine findings use their evidence boxes.
  - Each card has a category, title, explanation and primary fix. One-step fixes apply directly; rewrites arrive as proposals. Show on page, Ignore (persisted).
  - Category rows (Contact details, Dates, Layout, Section headings, Writing), mapped from the lint categories.
  - Selecting a card or pin outlines both. Score and bar badge update immediately.
- **New lint rule** for two-column templates (C4), with Keep and "Switch to one column".
- **Proposal core** (shared with M10): types, stale rule, page marks (a preview-only render with struck-through old text and highlighted new text), numbered margin markers, Accept, Reject, Accept all, A/R/↑↓ keys, undo.
- **Page view toggle** over the canvas: "What a person sees / What a parser reads". The parser view is the text the PDF engine extracts from the preview PDF, in reading order, with problems highlighted.
- **Deep check** runs the PDF engine on the current PDF in the background and reports in a toast.
- **Job match tab:**
  - Uses the linked application's posting (through `resume.application_id`), or a pasted posting.
  - Found and missing chips. A missing term asks where it belongs: Add to Skills, Ask the assistant (M10), or "Not true for me, hide it". Hidden terms persist. Labelled "not scored".
  - A pasted posting can be saved as an application (existing applications API until M8).
- **Writing tab:** opt-in AI review with its disclosure. The `ai-review` endpoint returns item-targeted rewrites as proposals. Errors stay inside the tab (C3).
- **Removes** the ATS sidebar section and the builder's deep-check UI.
- **Tests:** score computation; finding-to-target mapping; ignores; proposal accept, reject, stale, accept all and undo; the job-match term flow.
- **E2E:** new Check mode spec.

### M8 · Applications (L/XL)

PRs: list, detail and Add; board, insights, calendar and CSV.

- **Header:** title, CSV import/export icon, Add application; the dismissible follow-up nudge after 10+ days without a reply (dismissal remembered per device).
- **Toolbar:** List · Board · Insights (plus Calendar per Q3g), search across role, company and contact, Show closed.
- **List:** grouped by stage in the order Interview, Offer, Screening, Applied, Saved, Closed. Collapsible groups. Columns Role, Next step, Stage, Sent, Updated. Two-line rows below 640 px.
- **Board:** a column per stage; dragging tints the column and shows a toast; Move to… is the keyboard alternative. Desktop and tablet only.
- **Insights:** funnel (every application that reached each stage, closed ones included), heard back %, median days to first reply, tailored vs base comparison, plus Q3p.
- **Detail sheet** (480 px):
  - Header with View posting; clickable stepper and "Move to {next} →".
  - Next step card with Edit.
  - What you sent: sent versions with Open (read-only); Tailor a resume (duplicate, link, open the editor with the assistant); Write a letter (a new letter linked to the application).
  - Salary, Source, Applied, Contact; Notes (autosave); Activity.
  - Footer: "Close application…" with reasons, and "Prepare for next step" (assistant, M10). Delete in ⋯ behind an alert dialog, because it's permanent.
- **Add application dialog** (560 px). Paste a link or posting. A link is fetched on the server through a URL policy that blocks private addresses (the existing AI base-URL policy); then AI fills role, company, location and requirements. Without AI, the fields are filled by hand. Stage segmented control; Add, or "Add and tailor a resume".
- **CSV:** columns are matched automatically and confirmed before saving; skipped rows can be downloaded.
- **Data:** §3.7.
- **Tests:** status backfill and its reverse script; next-step derivation; insights maths; CSV column matching; `.ics` output; sent-version snapshots.
- **E2E:** update `applications-tracker`, `applications-export`.

### M9 · Cover letters on the editor shell (L)

- **Route** `/builder/letter/$coverLetterId`. Modes Write and Design; no Check.
- **Panel:** FOR (application card with Change), TO (Name or team, Company, Date, with the note), FROM (switch "Use details from '{resume}'"), Length (word count against the 180–320 band with hints), and the DESIGN note.
- **Page:** the letter layout from §3.8. The body is edited on the page. Spike C comes first: TipTap positioned over the body box from the page map, in the template's body font and size, while the PDF re-renders whenever typing pauses.
- **Draft from the posting.**
  - Streams into the body on a green wash, with the dark chip "Draft · uses only your resume and the posting" and Keep, Shorter, More personal, Discard.
  - A draft never overwrites typed text without Keep. A failure leaves the page unchanged.
  - Uses a streaming endpoint that doesn't need Redis (the agent's resumable streams do).
- **States and extras:** the linked-update notice (C2); downloading both files from the Share sheet; mobile typing on the page, the details sheet (tune) and the keyboard toolbar.
- **Data:** §3.8.
- **Removes** the `apps/web/src/features/cover-letters` library and editor dialog.
- **Tests:** greeting derivation; sender and design link sync; length hints; Keep and Discard; freeform letters render unchanged.
- **E2E:** replace `cover-letter-library`.

### M10 · Assistant (XL)

PRs: panel, thread and proposals; Improve, ⌘K Ask and past conversations.

- **Layout:** at ≥1280 the grid becomes 300 px, 1fr and 400 px, animated over 320 ms. At 1024–1279 the assistant replaces the left panel. Below 1024 it's a right drawer; on mobile, full screen. ⌘J toggles it.
- **Panel:**
  - Header: model chip listing tested providers, new conversation, past conversations, close.
  - Empty state with the four contextual suggestions.
  - Thread: streaming caret; Send becomes Stop; "Stopped. No edits were proposed. Continue".
  - Change sets: cards, page marks and "n proposed" pills in the outline.
  - Clarifying question card. "Yes, I have" leads to an editable draft bullet with "Add to resume" / "Discard"; "No, skip it" leads to the skipped note.
  - Composer: context chips that control what is sent, a two-row textarea, send/stop, and the disclosure naming the provider.
- **Inline Improve** from any rich-text field: Stronger verb, Add a result, Make it shorter, Ask for something else…. Suggestion card with Replace / Keep mine; results that add facts carry "Check it's accurate".
- **Outside the editor:** ⌘K → Ask works from Documents and Applications. Anything that edits a document opens it with the assistant ready.
- **States:**
  - No provider: inline setup for OpenAI, Anthropic and Other (OpenAI-compatible), through the providers API and its test.
  - Provider error: the message is kept, with Retry and Switch model.
  - Past conversations grouped by document, with outcomes.
  - Stale proposals.
  - A server without Redis or `ENCRYPTION_SECRET` says the assistant isn't set up on this server (see Q11).
- **Server:** the `propose_edits` tool for editor threads; threads bound to a resume or a letter (`agent_threads` gains `cover_letter_id`); proposal statuses persisted. `/agent` routes redirect (§2.2).
- **Removes** `apps/web/src/routes/agent/*`, the builder assistant sheet and the application copilot panel.
- **Tests:** proposal lifecycle including going stale after a manual edit; Accept all as one undo step; outline pill counts; stopping mid-stream; removing a context chip changes the request.
- **E2E:** assistant spec against a stubbed provider; redirects from `/agent/*`.

### M11 · Settings and public pages (L)

PRs: settings; shared resume; ATS checker.

- **Settings layout:** in-page nav (Account · Preferences · AI & developer; version, Docs, Source and Donate at the bottom) and a 680 px column. Sections are divided by rules, with no cards around form groups. Text saves on blur; toggles save at once.
- **Account:**
  - Profile: photo (new upload), Name, Username with the instance host as prefix, Email.
  - Sign-in & security: Password (Change), Two-step verification (switch leading to the QR flow and backup codes), passkeys per Q3o, and connected sign-in for every enabled provider.
  - Your data: Export everything (a zip of documents and applications as JSON); "Delete account…" (alert dialog listing what's removed, typing "delete", Keep account).
  - Sign out.
- **Preferences:** Light, Dark and System tiles; language with "Help translate"; the motion note.
- **AI & developer:**
  - Provider rows: name, default model, key ending, Test ("Connected · 420 ms" or the exact error), Edit. Add provider lists all 16.
  - API keys: table with revoke and undo; New key dialog (30 days, 90 days, Never); the key shown once with Copy.
  - MCP server: instance URL plus `/mcp`, Copy, Setup guide.
- **Mobile settings root:** three rows showing current values, Help & docs, Sign out.
- **Shared resume:**
  - Desktop: 64 px bar (name in Newsreader, headline and city, Copy link, Download PDF), the page on the sunken canvas, and the footer.
  - Mobile: semantic HTML reflow built from the `packages/pdf` semantic tree (layout order, filtering, template fonts and colours), contact pills, and pinned Download and share.
  - "This resume isn't shared right now." for off, unknown or trashed links. Slug redirects. With downloads off, Download is hidden and a print stylesheet blocks printing. `noindex`. Password page per Q3a.
- **ATS checker:**
  - Idle: Newsreader 44 heading, drop zone, optional posting. Busy: three steps.
  - Result: the 440 px column with the ring, issue rows, the "Fix these in the editor" CTA and "Check another file", plus the "Original page / As software reads it" lens.
  - Mobile: a single column with the CTA pinned.
  - The CTA signs the visitor up (or in), imports the same file and opens the new resume in Check.
- **Tests:** export zip contents; revoke and undo; provider test formatting; public page states; reflow order matches print order.
- **E2E:** update `auth`, `oauth-consent`, `public-sharing`, `sharing-password`, `public-resume-locale`, `root-public-resume`. Add an ATS checker happy path.

### M12 · Responsive pass, accessibility audit, cleanup (M)

- Re-check tablet drawer pinning in landscape, press-and-hold previews, bottom sheets and mobile flows on every screen.
- Accessibility audit against README §4.7 and §9: a keyboard-only pass per screen, focus return, roles (tablist, radiogroup, switch, menu, dialog and alertdialog, log), live regions, contrast, 44 px touch targets and reduced motion. Automated checks with `@axe-core/playwright` if approved (Q8).
- No preview Web Worker: the engine is replaced with Forme next (see Status).
- Cleanup: remove the compatibility aliases, Phosphor from app chrome, IBM Plex from the UI, the redirect stubs (per Q2), and unused primitives and dialogs; `pnpm knip` clean.
- The contract steps in §3.10 are proposed separately, not done here.

---

## 7. Decisions and deviations from the spec

- **Templates:** there are 15, so the gallery says "n of 15 shown". The prototypes' eight are stand-ins.
- **Check score:** "56 checks" is illustrative. Check counts the applicable live lint rules (21 today plus the new layout rule) and scores passed ÷ applicable × 100. The public checker only has a PDF, so it keeps the PDF engine's weighted score. Both show the limit statement.
- **ATS checker copy:** files never leave the browser today (25 MB cap, 30 pages), so "Up to 5 MB · deleted from our servers after the check" would be untrue. The copy describes what actually happens (Q9).
- **Host in copy:** "rxresu.me" becomes the instance host from `APP_URL` everywhere, for self-hosters.
- **Username characters:** the spec says `[a-z0-9-]`, but the server allows `[a-z0-9._-]` and existing usernames use dots and underscores. Validation stays as it is so no public link breaks.
- **Password change:** the spec says password changes confirm by email. Without SMTP, common for self-hosters, that would lock people out, so the password keeps today's in-app flow (current and new password). Email changes keep their confirmation.
- **Icons:** Material Symbols for the app; Phosphor stays for icons inside resumes (stored in resume data, rendered in PDFs).
- **Theme selector:** dark tokens live on the existing `.dark` class rather than `[data-theme="dark"]`, because 57 `dark:` uses depend on it. New visitors default to System.
- **Rich text:** headings, colours and alignment leave the toolbar but are still parsed, so existing descriptions keep their formatting until the user clears it. Nothing is stripped silently.
- **Dates:** year-only values are valid (Q5). Unreadable text prints as before until fixed.
- **Presets:** the spec's point values (30/44/60 margins, 1.32/1.45/1.60 line heights) come from the prototype renderer. They're recalibrated against the real templates in M4 so that Normal equals today's defaults.
- **Lock:** locking no longer asks for confirmation, since it's reversible.
- **Confirmations:** only for Trash → Delete now, deleting an application (permanent; the spec gives applications no Trash) and deleting the account. Typing "delete" only for the account.
- **Letters:** no public link for letters (not in the spec). Their Share sheet has Download and History.
- **Document menu trigger:** the document name in the editor bar. The spec names the menu but not its trigger.
- **⋯ menus on section rows and entry cards:** added to hold the section and entry options the spec doesn't place (§5.3).
- **Assistant width:** README §6.5 (300 px, 1fr, 400 px at ≥1280) wins over the Design System note (a 360 px column).
- **Per-device state:** the "New" badge and the follow-up nudge dismissal are stored per device. Both are cosmetic.
- **Download count:** covers the last 30 days, like views.
- **PDF engine work waits for Forme:** Sidebar Left/Right (per-template mirroring) and moving rendering to a Web Worker are dropped from this phase. The Custom CSS editor is hosted in Design → Advanced as it is.

---

## 8. Risks and spikes

| Risk                                         | Why                                                                                                                                                                                 | Mitigation                                                                                                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main-thread rendering                        | Every edit re-renders the whole document with react-pdf on the main thread. Inline editing renders while typing; the gallery renders 15 documents; hover previews and Fit add more. | Spike A. Cache renders by data hash, render thumbnails at idle time, lengthen the debounce while typing, and move react-pdf to a Web Worker if p95 is too high (plausible because fonts load by URL, but unproven here). |
| Page map relies on an internal react-pdf API | The layout tree passed to `Document.onRender` isn't public. Boxes are relative to parents. Field-level boxes would need a text-layout patch.                                        | Keep the patched renderer pinned. Unit-test the box maths against fixtures. Stay item-level. If layout data is missing, the panel still works.                                                                           |
| Editing the letter body on the page          | The page is a canvas, and HTML and PDF line breaks differ                                                                                                                           | Spike C at the start of M9. Fallback, with your OK (Q10): edit the body in the panel while the page updates.                                                                                                             |
| Sidebar Left/Right                           | The eight two-column templates hard-code their side, and three put the header in the sidebar                                                                                        | Mirror per template in M4. If a template can't mirror cleanly, its Left/Right control is hidden.                                                                                                                         |
| Structured dates                             | Parsed dates print in a normalised format; the public API and MCP shape changes; 55 locales                                                                                         | Dual write, the `raw` fallback, a date format option (Q4), a changelog entry, tests per locale.                                                                                                                          |
| Assistant behaviour change                   | Today's builder assistant applies edits directly by default; the new one only proposes                                                                                              | Server tool and prompt changes. MCP and API are untouched.                                                                                                                                                               |
| Stage rollback                               | Older versions can't read `closed`                                                                                                                                                  | Reverse script shipped with the migration.                                                                                                                                                                               |
| E2E churn                                    | Many specs select today's structure (XPath hops, `data-slot`, ids)                                                                                                                  | Update specs in the milestone that changes each screen; prefer role and label selectors.                                                                                                                                 |
| Translation volume                           | Hundreds of new strings across 55 catalogs, and Crowdin lag                                                                                                                         | English fallback until translated. The section-title messages stay untouched (the PDF catalog tooling throws if they change).                                                                                            |
| Branch drift                                 | 12 milestones, several XL                                                                                                                                                           | Q1. Merge `main` into the integration branch weekly. Additive migrations can land on `main` early.                                                                                                                       |
| Self-hosting variations                      | No Redis, no SMTP, no AI keys                                                                                                                                                       | An explicit state for each (assistant unavailable, emails logged, AI features explained).                                                                                                                                |

---

## 9. Questions for you

**Answered 28 Sep 2026: "accept recommendations".** Every recommendation below is the decision. Q10 is yes (the panel fallback is allowed if Spike C fails) and Q11 is yes (the assistant also works without Redis).

**Before M1**

1. **Rollout.** Recommended: an integration branch (`redesign/desk-and-paper`) with one PR per milestone (or per listed split), released together; additive migrations may land on `main` earlier. Alternatives: `main` behind an instance flag (two UIs to maintain), or piecemeal releases (a mixed UI across versions).
2. **Release.** Recommended: v6.0.0, because the IA, routes, API date shape and assistant behaviour all change. Redirect stubs stay through 6.0.x and go in 6.1.
3. **Capabilities the spec doesn't place (§5).** Recommended: approve every "Proposed" placement, and:
   - a. Password-protected links: keep, as a "Require a password" row under the address in Share → Link.
   - b. Any font family, weights and hyphenation: keep, in Design → Advanced.
   - c. Text and background colours: keep, in Design → Advanced.
   - d. Skill and language level display: keep, in Design → Advanced.
   - e. Free-form page format: keep, in Design → Advanced; Paper stays Letter/A4.
   - f. Multi-page layout: keep. Page dividers in the outline; Move to page and New page in the row menu; keep together and start on new page in the row menu; per-page full width in Design → Sidebar.
   - g. Interview calendar (#3539): keep, as a fourth Applications view, Calendar, on desktop and tablet.
   - h. Application tags, sort, bulk actions and PDF uploads: keep tags (in the detail sheet and in search), sort by clicking list headers, bulk actions through row checkboxes, and uploads as "Attach a file instead" under What you sent.
   - i. Copilot fit score and follow-up drafts: become assistant suggestions under "Prepare for next step". The stored match score is no longer shown.
   - j. Agent extras: keep attachments, web-search sources and Copy transcript. Drop AI-draft copies, blank drafts (Start blank plus the assistant covers it), token counts and thread archiving.
   - k. Letters inside resumes: keep them as a custom section type (no data change) and add "Move to Documents" to that section's menu.
   - l. Public-checker AI review for signed-in users: drop it; Check → Writing covers it.
   - m. The page stacking toggle and the fullscreen rich-text editor: drop both.
   - n. Donation toast: keep today's behaviour, outside the editor.
   - o. Passkeys and every enabled sign-in provider: keep, in Sign-in & security.
   - p. Insights extras (weekly and by-source charts, PNG export): keep, below the spec's content.
4. **Date format.** Recommended: add "Date format" to Design → Advanced (Mar 2022, March 2022, 03/2022, 2022-03; default Mar 2022). Today people pick their format by how they type it, and structured dates would otherwise remove that choice.
5. **Year-only dates** such as "2014 – 2018": recommended to accept them as valid, without a review flag.
6. **Legacy `period`/`date` for API and MCP clients:** recommended to keep dual-writing them through 6.x.
7. **Handoff folder:** recommended at the repo root, with a `.gitignore` entry.
8. **New dependencies:** `@fontsource-variable/newsreader`, `@fontsource-variable/hanken-grotesk` and `@fontsource-variable/jetbrains-mono`; a checked-in Material Symbols subset font built by a tooling script (the alternative is `@material-symbols/svg-300`); and `@axe-core/playwright` as a dev dependency in M12. Recommended: approve.
9. **Copy that would be untrue as written.** Recommended: "Up to 25 MB · checked in your browser, never uploaded" instead of "Up to 5 MB · deleted from our servers after the check". "56 checks" and "n of 14" become the real numbers.

**During the build**

- **Q10 (M9):** if on-page editing of the letter body (Spike C) proves unreliable, may I fall back to editing the body in the panel while the page updates live?
- **Q11 (M10):** the assistant needs Redis for resumable streams today. Should the panel also work without Redis, using plain streaming without resume-after-reload? Recommended: yes, because it widens self-hosting support.

---

## 10. Verification per milestone

**Repository gates**, filtered to the packages a milestone touches:

- `pnpm --filter web typecheck`, plus `pnpm --filter @reactive-resume/<package> typecheck` for each changed package.
- `pnpm --filter web test`, plus the tests of each changed package (`ui`, `schema`, `resume`, `pdf`, `api`, `import`, `docx`, `mcp`).
- `pnpm exec turbo boundaries`.
- `pnpm exec oxlint --deny-warnings <changed paths>` and `pnpm exec oxfmt --check <changed paths>` to inspect without writing, then `pnpm check`, which applies safe lint fixes and formatting.
- `pnpm knip`.
- `pnpm lingui:extract` when copy changes. It rewrites the PO catalogs and the PDF section-title catalog.
- `pnpm db:generate`, then `pnpm db:migrate` against the local database, for milestones with schema changes. Review the generated SQL.
- The affected Playwright specs through `pnpm test:e2e` (needs Postgres).

**README §9 checklist**, per screen:

- At most one accent-filled button visible.
- Light and dark; the paper stays white.
- Keyboard-complete, with a visible focus ring and correct Esc and focus return.
- Every destructive action is undoable, or confirmed when irreversible.
- Empty, loading, error and success states as specified.
- `prefers-reduced-motion` removes movement.
- Layouts at <640, 640–1023 and ≥1024 (and ≥1280 where the assistant matters).
- Text contrast of at least 4.5:1; touch targets of at least 44 px on touch devices.
- Copy matches the prototypes, and every string goes through Lingui.

**Milestone summary:** what changed, test results, anything that differs from the spec and why, and anything deferred.

---

## 11. Spike results (M0)

Measured on 28 Sep 2026 in Node (Apple silicon) with `renderToBuffer`, fonts warmed, sample resume with the picture hidden, 8 runs each.

**Spike A, render cost (react-pdf layout and serialisation only, no pdf.js painting):**

| Content                               | Onyx                 | Azurill              | Bronzor               | Gengar               |
| ------------------------------------- | -------------------- | -------------------- | --------------------- | -------------------- |
| 1 authored page (1–2 physical pages)  | p50 41 ms, p95 52 ms | p50 39 ms, p95 43 ms | p50 37 ms, p95 39 ms  | p50 31 ms, p95 33 ms |
| 4 authored pages (4–6 physical pages) | p50 87 ms, p95 88 ms | p50 77 ms, p95 87 ms | p50 85 ms, p95 101 ms | p50 82 ms, p95 84 ms |

Decisions:

- Rendering stays on the main thread for now. In the browser, expect roughly 1.5–2× these numbers plus pdf.js painting, so M2 re-measures in the real preview (render and paint) before M3 turns on per-keystroke rendering.
- While a field has focus, the preview waits for a pause in typing (about 250 ms) instead of the current 100 ms.
- The template gallery's 15 thumbnails cost roughly 0.5–1.5 s of work in total; they render one at a time at idle, so no worker is needed yet.
- Fit to one page needs at most about 10 renders, which fits inside a second.
- A Web Worker stays the fallback if M2's in-browser p95 is above about 150 ms for a two-page resume.

**Spike B, page map: works on all 15 templates.**

- Templates now tag the views that own the header, each section and each item with `data-resume-node` (in `Div`, `SemanticHeaderView` and `SectionShell`). The attribute never reaches the PDF: React PDF keeps it on layout nodes only.
- `ResumeDocument` takes `onPageMap`, which receives `extractPageMap(layout)` after each render. The module is exported as `@reactive-resume/pdf/page-map`.
- Child boxes in React PDF's layout tree are relative to their parent's box, so offsets are summed per physical page. Extraction costs under 1 ms for 2,000 tagged nodes.
- Templates that merge main and sidebar into one region (Bronzor, Scizor) qualify section keys with their origin (`main:experience`); the key parser strips it.
- `page-map.integration.test.tsx` renders every template and checks the header and every experience entry are mapped inside the page bounds, so a template change that drops the tags fails CI.
- Page-map entries are item-level, as planned. Field-level boxes would still need a text-layout patch; nothing in the spec requires them.

---

## 12. Milestone log

### M0 · Preparation and spikes (done 28 Sep 2026)

- Integration branch `redesign/desk-and-paper`; handoff folder at the repo root and in `.gitignore`.
- Page map in `packages/pdf` (§11), with an integration test over all 15 templates.

### M1 · Tokens, theming, primitives (done 28 Sep 2026)

What changed:

- **Tokens:** Desk & Paper tokens in `packages/ui/src/styles/globals.css` (light on `:root`, dark on `.dark`), exposed to Tailwind under their spec names (`bg-surface`, `text-ink-2`, `bg-accent-soft`, `shadow-e2`, `duration-standard`, `ease-enter`, `rounded-xl`…). The old shadcn names resolve to the new tokens until M12. About 100 hard-coded palette classes became semantic tokens; company initial tiles became neutral as in the spec.
- **Fonts:** Newsreader (optical sizes), Hanken Grotesk and JetBrains Mono via `@fontsource-variable`; IBM Plex left the UI package (email templates still use it). The Insights PNG export inlines Hanken Grotesk.
- **Icons:** `Icon` renders a self-hosted Material Symbols Rounded subset (101 glyphs, 36 KB). `pnpm icons:build` validates names against Google's codepoints and rebuilds it; a unit test keeps the manifest and the list in sync. The UI package no longer uses Phosphor; icons inside resumes still do.
- **Theme:** Light, Dark and System (new default). System follows the OS live; an inline script in `index.html` sets the theme before first paint; the loader and `theme-color` follow the theme.
- **Primitives** restyled to the spec: Button (primary, secondary, ghost, danger, link; sm, default, lg and icon sizes; `loading`), inputs and input groups (accent focus ring), Label, Checkbox, Switch plus the new `SwitchRow`, Badge (neutral, accent, solid, warn, danger, info, outline, inverse), Tabs (segmented and underline, plus `TabsCount`), Slider, Toggle, ButtonGroup, Dialog, AlertDialog, Sheet (side and bottom with grabber), Popover, Tooltip, dropdown and context menus (shared styles), Combobox, Command (52px search row, ↵ hint), Toast (one at a time, bottom center, Undo action), Alert (info, success, warn, error; only errors are announced), Empty, Avatar, Accordion, Skeleton (no pulse), Spinner (CSS ring, `decorative`), Form messages (error icon). New: `Icon`, `IconButton`, `SegmentedControl`, `RadioGroup`, `NativeSelect`.
- **Fixes:** `DirectionProvider` now receives the locale's direction, so Base UI components follow right-to-left layouts.
- **Docs:** `DESIGN.md` rewritten for Desk & Paper; `GLOSSARY.md` has the redesign terms; catalogs extracted.

Differences from the plan, with reasons:

- `FileDropZone`, the step list, the structured date input and the radio card are built with their first screens (M6, M6, M3 and M5), so their APIs follow real use rather than guesses.
- The Motion (JS) mirrors of the new durations are added in M2, where the first animation uses them; knip rejects unused exports.
- Button variant names now match the spec (`primary`, `secondary`, `danger`); every call site was updated through the type checker. Badge variants are semantic (`neutral`, `accent`, `warn`, `danger`, `info`…).
- The icon build script reads `names.ts` as text because Turborepo boundaries don't let tooling depend on the browser-only UI package.
- Turborepo adds an "agent guidance" block to `AGENTS.md` whenever it runs under an AI agent; it is left out of these commits. Setting `"agentGuidance": false` in `turbo.json` stops it (your call).

Verification: typecheck for ui, web, pdf, schema and tooling; tests for ui (361), web (963), schema (132) and tooling (109); `turbo boundaries`, knip, Biome and markdownlint clean. Checked in the browser against an isolated database: sign-up, dashboard, the create dialog and its menu, the builder with a sample resume (preview renders), toasts and the command bar, in light and dark.

### M2 · Editor shell (done 28 Sep 2026)

What changed:

- **Shell:** `/builder/$resumeId` is one editor: a 56px bar over the panel and the page canvas. The mode lives in `?mode=` (Write is the default) and switches at once; the URL follows in the background, because every navigation first refetches the session and flags. Tablets get a 380px drawer that tapping the page closes and tapping a line opens on that entry; in landscape it can be pinned beside the page. Phones get the Write · Page · Design · Check tabs, and the page pauses rendering while hidden.
- **Editor bar:** back link, the document name (opens the document menu) with the save status under it, the mode switch with the Check badge (open-issue count or a check), then Undo, Version history, Assistant, Share (with the live dot) and the Download PDF split button, whose ▾ opens every format. Tablets and phones collapse Share and Download to icons.
- **Document menu:** Rename, Duplicate, Lock/Unlock (no confirmation, since it's reversible), Notes, Information, Print and Delete.
- **Save status:** Saving…, Saved, "Offline · saved on this device" and "Not saved · Retry". Failed saves keep the draft on the device (localStorage, per resume), retry when the connection returns, and restore when the editor opens again. The failure toast is gone; the status line says it. While offline, the panel shows the banner from the prototype, and Share, Download and their shortcuts are disabled.
- **Undo:** 200 steps held as immer's shared trees instead of deep copies. Typing in one field within a second is one step; structural actions (hide, sort, reorder, add, delete) are steps of their own.
- **Page canvas:** the sunken desk with the page caption, page shadow and the zoom bar (−, Fit, +, page count; 60–150%, ⌘0 fits). Zoom re-renders the page at the new scale instead of transforming it, so `react-zoom-pan-pinch` is gone.
- **Page map and selection:** a pointer layer over each page tints blocks on hover. Clicking one selects its entry, outlines it with the "Editing" tag and scrolls the Write panel to it; focusing a field in the panel outlines its block on the page. On phones, tapping a line shows the dark "Edit entry" bar.
- **Keymap:** 1, 2 and 3 switch modes outside fields; ⌘Z, ⇧⌘Z and Ctrl+Y undo and redo outside fields; ⌘P downloads the PDF; ⌘⇧S opens Share; ⌘⇧E opens Download; ⌘J toggles the assistant; Esc clears the selection.
- **Hosted panels (no gaps):** Write hosts today's section editors, Design the template, layout, typography, design, page and custom-style sections, and Check the ATS check. The Share & export sheet hosts sharing, statistics and a "More download formats…" button (the only path to other formats on phones).
- **Icons** draw their glyph from `data-icon` in a pseudo-element, so icon names no longer leak into copied text, find-in-page or text queries.
- **Removed:** the resizable-panel shells, both icon rails, the dock, the header, the mobile shell, the focus-mode sizing helper and the sidebar store.

Differences from the plan, with reasons:

- **Undo labels** for the toast ("Entry deleted · Undo") arrive in M3 with the first toast that uses them.
- **Key decoding** needs no test of its own: the keymap uses `@tanstack/react-hotkeys` rather than a custom decoder. The mode hook and the hand-off between a picked mode and the URL are tested instead.
- **Motion (JS) mirrors** of the durations are still unneeded: every M2 animation is CSS.
- **Delete** still deletes permanently after a confirmation; it becomes Move to Trash with undo in M6.
- **Redo** has no button, as in the spec's bar; ⇧⌘Z and Ctrl+Y redo.
- **The account menu** left the editor, as the spec's bar has none. ⌘K still switches theme and language from the editor; signing out is on the dashboard.
- **Phones:** pinch-to-zoom is the browser's own for now, and "Improve" joins "Edit entry" in M10.
- **Tablet pinning** lasts for the open document rather than being remembered.
- **Render cost:** re-measuring the preview in the browser (render and paint) moves to the start of M3. The in-app browser throttles hidden pages, so its numbers weren't trustworthy.

Verification: typecheck for web, ui and pdf; tests for web (946) and ui (369); `turbo boundaries`, knip and Biome clean; catalogs extracted. Checked in the browser against the isolated database at 1440, tablet portrait and landscape, and phone widths, in light and dark: modes, page click to panel, panel focus to page, document menu, Download dialog, Share sheet, tablet drawer and pin, the phone "Edit entry" bar, and offline → online replay.

E2E: specs updated for the new editor (`builder-save-navigation`, `section-recovery`, `section-date-sorting`, `preview-direction`, `template-switch`, `json-export-import`, `hyphenation`, `offline-fonts`, `preview-export-geometry`) and the shared helpers (`openSidebarSection` now picks the mode or opens the Share sheet; new `openDownloadDialog`). Run locally against the dev server: save-navigation, section recovery, editing and date sorting, preview direction (all four), template switch, JSON export and import, lock, sharing, password and download preference all pass. Hyphenation passes up to its server-side PDF step, which fails only under the dev server: `tsx watch` compiles `packages/pdf` with its `"jsx": "preserve"` tsconfig into `React.createElement` calls. That's unrelated to this change; the production build used by CI isn't affected. The opt-in geometry spec was adapted to page-scale zoom (Fit, 100%, 70%) but not run.

### M3 · Write (done 28 Sep 2026)

What changed:

- **Structured dates** (§3.2). Dated entries and roles carry `dates` (`start`, `end`, `present`, and `raw` when the text couldn't be read exactly). `@reactive-resume/schema/resume/dates` owns the model: the parser (moved from `packages/resume`, now reporting how each date was written), the reading of legacy text, the formatter (Mar 2022, March 2022, 03/2022, 2022-03) and `syncResumeDates`, which keeps the legacy `period`/`date` text in step (the dual write). `parseResumeData` upgrades on read: it fills `dates`, infers `metadata.page.dateFormat` from how dates were typed, and rewrites the text from the dates. Every API write validates, upgrades and syncs against the stored data, so a client that edits only the text still works. The editor's draft store runs the same sync, so autosave echoes stay identical to the draft.
- **Readers:** `resume.getById` and `getBySlug` now return upgraded data (they returned stored data as-is). ATS date rules and "Sort by date" read `dates`. The JSON Resume and LinkedIn importers map their structured dates directly. The MCP patch tool documents `dates`, and the MCP schema resource is generated live (the committed `schema.json` was stale and is gone).
- **Drafts:** title fields no longer require text, so a new entry saves as a draft. The renderer already skipped untitled entries.
- **Write panel** (`apps/web/src/features/resume/editor/write`):
  - The Basics card: initials, name and "headline · location", the photo row (the existing picture options in a popover), contact fields with email validation on blur, and "Add field".
  - The outline in print order, with page dividers and a "Sidebar" divider on two-column pages. Each row has a drag handle, title, count, "n to check" for dates to review, eye and chevron, plus a ⋯ menu: add, sort by date, move up/down, rename, icon, heading, columns, keyword layout, keep together, start on a new page, and clear or delete (both with Undo).
  - Sections and entries reorder by dnd-kit drag or ⌥↑/⌥↓, with Move up/down in the row menu. Drops write the layout.
  - Entry cards: title and "company · location · dates". One is open at a time (the editor selection), with fields in a two-column grid and a delete icon (Undo toast). The ⋯ menu offers hide, duplicate, move to another section or page, and delete.
  - Drafts show "Untitled", "Draft · not printed" and what they still need.
  - The structured date field: typed month-year in any readable form, year-only allowed, a Present switch, and the review note for `raw`.
  - Rich text with the restricted toolbar on focus (Bold, Italic, Link, lists, Clear formatting), Markdown shortcuts and a character count. The summary shows "2–3 sentences reads best".
  - Add section: unused sections in two columns, plus Custom section by type. Each new section starts with a focused draft entry. A blank resume shows suggested sections as chips, "Import it", and opens into the name field.
  - Page ↔ panel: a click on the page opens the entry, collapses Basics and scrolls it 60 px from the top. Focusing a field outlines its block. Phones push an open entry full screen with "‹ Section" and delete.
- **Preview:** while a field has focus, the page waits 250 ms for a pause in typing (100 ms otherwise).
- **Removed:** the left section sidebar, the 14 entry dialogs and their registry, the hidden-sections list (hidden sections stay in the outline), and the helpers only they used.

Differences from the plan, with reasons:

- **The formatter lives next to the parser** in `packages/schema`, because `parseResumeData` needs it to keep the legacy text in step. That is the same reason the plan moved the parser.
- **Renderers still print `period`/`date`.** Parsing rewrites that text from `dates`, and both PDF entry points and DOCX parse their input, so the templates needed no change. Only code that interprets dates (ATS rules, sorting) reads `dates`.
- **Approximate dates print as typed** ("Summer 2016") until someone reviews them, rather than printing the approximate reading. Existing resumes don't change on upgrade.
- **"Present"** comes from a generated catalog (`present-labels.json`, from the web's "Present" message). Locales without a translation fall back to the parser's word for the language ("Heute").
- **The date format is inferred** on upgrade from how the dates were typed, so "March 2022" stays long. The Design → Advanced control comes in M4.
- **AI import still preserves dates as written.** The save reads them and flags uncertain ones, which gives the D2 review flags.
- **Smaller controls:**
  - Section icons are set from the row menu, because the spec's row has no icon slot.
  - Roles and custom fields reorder with up/down buttons.
- **Not yet built:**
  - The mobile toolbar docked over the keyboard with Done.
  - The D2 "Imported from…" banner, which comes with the import flow in M6.
  - Improve, which comes in M10.
- **Render cost (re-measured in production, headless Chromium):** 2 pages p50 228 ms / p95 285 ms; 4 pages p50 289 / p95 559. Both include pdf.js painting and the page swap. That is above the ~150 ms at which the plan falls back to rendering in a Web Worker. A worker moves the work off the main thread but doesn't make the page appear sooner, and the typing pause already keeps renders out of keystrokes, so the worker is deferred to M12 unless you want it sooner.

Verification:

- Typecheck is clean for schema, resume, api, import, mcp, pdf, docx, ai, tooling, ui and web.
- Tests pass: schema 236, resume 1315, api 440, import 176, mcp 67, pdf 1056, docx 76, ai 40, tooling 110, ui 369, web 919.
- knip, `turbo boundaries` and Biome are clean, and catalogs are extracted.
- E2E: updated `section-editing` (inline add), `section-date-sorting` (row menu, structured dates, locked read-only), `section-recovery` (eye on the row), `picture-upload` (photo row), `json-export-import` and `builder-save-navigation` (Full name). Added `click-to-select`. `public-download-preference` now waits for the share address, which fixes a race.
- Every builder spec passes locally against the dev server. Checked in the browser at desktop and phone widths.

### M4 · Design (done 28 Sep 2026)

What changed:

- **Design panel** (`B/-components/design-panel.tsx`, groups in `apps/web/src/features/resume/editor/design`): a sticky group nav (Template · Type · Color · Page · Advanced) that scrolls to each group, groups divided by rules, and the whole panel read-only while the resume is locked.
- **Template:**
  - Filter chips (All, One column, Two columns, ATS-safe) with "n of 15 shown".
  - Thumbnails rendered from the user's own content, font and colour. They render one at a time when the browser is idle, are cached by template and a content hash, and show the template's sample image until ready, so the grid never jumps.
  - Hover or keyboard focus previews the template on the page with the dark "Previewing X · click to apply" chip. On touch, holding a card previews it. Leaving the cards or Esc restores the page. A click applies the template with "Template changed to X · Undo".
  - Two-column templates add a Sidebar sub-panel: width 26–42 %, chips that move sections between the sidebar and the main column, and the ATS column-order warning.
- **Type:** five pairings as radio rows, text size 9–12.5 pt in 0.5 pt steps (the heading keeps its ratio to the body), and density.
- **Color:** eight accents, a hex field with its live contrast on white, and below 4.5:1 the warning with "Use a darker shade" (same hue, darkened to at least 4.6:1).
- **Page:** Letter/A4 (Free-form appears only while in use), language, margins, "Icons in contact line" and "Underline links".
- **Advanced** (collapsed): Date format (Mar 2022, March 2022, 03/2022, 2022-03; Q4), then every exact-value editor: typography with any family, weights and hyphenation (Q3b), text and background colours and level display (Q3c, Q3d), page gaps, section icons and free-form (Q3e), the multi-page layout (Q3f) and custom CSS. Then "Reset to template defaults" with Undo.
- **Overflow and Fit:**
  - The canvas reads the page map. When the physical pages exceed the authored pages it shows "Runs onto page N by about X lines" with Fit, and a dashed warn line labelled with each spilled page.
  - Fit tightens density, then margins, then size in 0.5 pt steps (never below 9 pt), waiting for each re-render and re-measuring. The run is one undo step (a new `sameStep` option on the draft store) and ends with the spec's success or failure toast.
- **Phones:** Design is a half-height sheet over the live page (the handle raises it to full height) with Template · Type · Color · Page tabs, a horizontal template strip and 48 px swatches on touch. Advanced sits under Page.
- **Template layouts:** `templateLayouts` in `packages/schema/src/templates.ts` is the single source for columns, sidebar side, header placement and ATS safety. The gallery and the layout editor read it, and a DOCX test checks the two-column configurations against it.
- **Removed:** the template gallery dialog, the Template section, the collapsible section chrome with its persisted collapse store (only titled hosts remained), and the Language field repeated in Advanced.
- **Also:**
  - ATS design findings now scroll to the Design group that fixes them (Type, Page or Template).
  - The desktop panel is now a containing block. Screen-reader text deep in a long panel had stretched the document, so `scrollIntoView` could shift the whole editor up by the bar's height.
  - **Fixed an M3 regression:** the entry dialogs removed in M3 carried "Import from library", which copies a saved letter into a resume's cover-letter entry. A new, empty cover-letter entry now offers that picker inline.

Differences from the plan, with reasons:

- **Presets are calibrated so Normal equals today's defaults.** Density sets body line height and section gap: Compact 1.35 / 4, Normal 1.5 / 6, Roomy 1.65 / 8. Margins (horizontal / vertical) are Narrow 10 / 8, Normal 14 / 12 and Wide 19 / 16. The spec's 1.32/1.45/1.60 and 30/44/60 pt came from the prototype renderer and would have changed every existing resume.
- **Sidebar Left/Right is hidden.** The templates hard-code their side, and three put the header in the sidebar. Mirroring needs per-template PDF work, which waits for Forme.
- **"Reset to template defaults" restores the look only:** type, colours, level display, spacing, icons, link underlines and sidebar width. Paper, language, date format, section placement and custom CSS stay. The prototype also resets paper, language and sidebar sections. Templates have no defaults of their own here, so the reset uses the app defaults.
- **The template switch reuses the page's layer cross-fade** (150 ms in, then the old layer drops) rather than a separate 0.35 → 1 fade over 200 ms.
- **The mobile sheet toggles between half and full height** with its handle; there is no drag gesture.
- **Thumbnails re-render at idle when the content changes** while Design is open: about 15 renders of roughly 230 ms each, one at a time. Rendering cost is left to Forme.
- **Still to come:** the Check "Layout" issue for two-column templates (M7; the live lint already flags sidebar sections) and single-column DOCX layout alignment (M7).

Verification:

- Typecheck is clean for web, schema and docx.
- Tests pass: web 923, schema 236, docx 77. New tests cover the presets and their calibration, contrast and darkening, the Fit step order with the 9 pt floor, the overflow measure, and the template cards (hover, Esc, apply with undo, touch hold, filters).
- knip, `turbo boundaries` and Biome are clean, and catalogs are extracted.
- E2E: `template-switch` now previews on hover, applies from the card, checks the choice after a reload and undoes from the toast. The section helper opens Design groups and the sections inside Advanced. `cover-letter-library` drives the inline library picker. `hyphenation` and `preview-direction` pass.
- The full suite passes against the dev server, except the server-PDF steps of `hyphenation` and `public-resume-locale`, which fail only under the dev server (see M3). Both pass against the production build, as do `template-switch`, `preview-direction`, `cover-letter-library` and `click-to-select`.
- Checked with headless Chromium at desktop and phone widths: hover preview, the contrast warning and darker shade, Advanced, overflow at 12.5 pt and Fit (six pages back to four: Compact, 11.5 pt).

### M5 · Share & export, History (done 28 Sep 2026)

What changed:

- **Data (§3.4, §3.5):**
  - `resume_version` gains `kind`, `name` and `session_id`. The migration backfills `kind` from the English labels; `label` stays for API clients.
  - Each editor visit sends a session id with `resume.update`, and its saves share one autosave version, refreshed at most every two minutes.
  - Creating a resume writes a `created` version and importing an `import` one.
  - New procedures: `getVersion`, `createVersion`, `renameVersion` and `deleteVersion` (named versions only), and `checkSlug`.
  - `resume_slug_redirect` keeps a renamed resume's old slug for 30 days. `getBySlug` and `verifyPassword` resolve it, and the public route redirects to the current address.
  - `create` and `duplicate` generate a unique slug from the name when none is given; `duplicate` no longer falls back to the original's slug, which always collided. The resume dialogs stop asking for a slug, which also stops Rename from overwriting a custom slug.
- **Sheet:** one 440 px sheet (a full-height bottom sheet on phones) with Link, Download and History. Share opens Link, ▾ opens Download, the clock opens History, and ⌘⇧S / ⌘⇧E open their tabs. On desktop the page moves 120 px aside.
- **Link:**
  - The public switch card, then the address with its live check (300 ms), the reason a slug can't be used and a suggestion.
  - A new address is saved only once it checks out, so the old one stays live until then.
  - Copy ("Copied" for 2 s), "Visitors can download the PDF", "Require a password" (Q3a), Open public page, a QR code and, on touch devices, Share via….
  - Views, downloads and time since the last view over 30 days in Newsreader numerals, with the 30-bar chart, or the explanation while the link is off.
- **Download:** format cards with the spec's copy and "Best for applying"; Resume or Cover letter (with the resume-header option) when the resume has a letter; the file name recruiters see (`First-Last-Resume`, unsafe characters stripped); the non-blocking Check note with Review; progress inside the 44 px button; and on failure an alert, Try again and "Download PDF instead".
- **History:**
  - "Name this version", then a timeline of Now, editing sessions, named versions (bookmark), restores and where the document came from.
  - Picking a version shows it on the page, read-only, with a 2 px ink outline and the dark banner. Restore saves "Before restore" first; naming or restoring saves pending edits first.
  - Named versions can be renamed or deleted.
- **Removed:** the download dialog, the version-history menu, and the sharing, statistics and export sections.

Differences from the plan, with reasons:

- **Retention runs when a resume gets a new version**, not in a daily job. There is no scheduler, and the Vercel entry skips startup hooks. Resumes nobody edits keep their old autosaves, which doesn't grow storage.
- **Restore and Back to now live in the History tab** as well as the page banner's text. The sheet is modal (focus is trapped in it), so the banner on the page can't hold working buttons; it shows the status.
- **Editing sessions are titled "Editing session".** The prototype's summaries ("Rewrote Studio Kettle bullet") need change tracking the app doesn't have.
- **A session's version can trail its last two minutes of edits**, because refreshes are throttled like today's autosaves. Now always shows the current state.
- **The chart has no "Sent to …" marker yet.** It needs applications, which come in M8.
- **Deleting a named version asks first.** It can't be undone, and §7's confirmation list didn't consider versions.
- **File names:** every export, including the one-click PDF and public visitors' downloads, now uses `First-Last-Resume`. Public visitors used to get `resume.pdf`.
- **Slugs given at creation aren't pattern-checked** (API and MCP callers); only changes are, so existing slugs keep working.
- **Esc closes the sheet** (and returns the page to now) rather than first leaving a preview.
- **Found, not changed:** "Visitors can download the PDF" hides the buttons only; the public PDF endpoint doesn't enforce it, as before.
- **Migration:** it also applies the drop of the redundant `resume_user_id_index`, which was removed from the schema in `b953435f2` without a migration.

Verification:

- Typecheck is clean for web, api, mcp and db.
- Tests pass: api 469, web 915, mcp 67, utils 215, db 5. New tests cover version writing, session refresh and retention, named-version guards, the slug pattern, checks, suggestions and redirects, the update and create paths, the Link tab's password and address flows, and the stats and time formats.
- knip, `turbo boundaries` and Biome are clean, and catalogs are extracted.
- E2E: updated `public-sharing`, `sharing-password`, `public-download-preference`, `json-export-import`, `hyphenation`, `section-recovery`, `offline-fonts` and `preview-export-geometry`. Added `share-history`: renaming the address with the old one redirecting, and naming, previewing and restoring versions.
- The full suite passes against the dev server except the known dev-only server-PDF steps; `hyphenation`, `public-resume-locale`, `section-recovery`, `share-history`, `public-sharing` and `json-export-import` pass against the production build.

### M6 · Documents & New (done 28 Sep 2026)

What changed:

- **Data (§3.3):**
  - `resume` gains `application_id` (the job a copy was made for; set null when the application goes), `trashed_at` and `auto_name`. `cover_letter` gains `tags`, `is_locked` and `trashed_at`. The migration only adds columns and the foreign key.
  - A new `documents` feature lists resumes and letters together with their linked application, counts them, and renames, tags, locks, links, trashes, restores, deletes for good (`purge`) and copies for a job. `copyForJob` links the copy to the application and, when the application has no resume yet, the application to the copy.
  - Moving to Trash replaces deleting: `resume.delete`, `coverLetters.delete` and the MCP `deleteResume` tool now move to Trash. Trashed documents drop out of lists, their public page stops, and their slug stays reserved until they are deleted for good.
  - Locked documents can't be renamed, tagged, linked or trashed. A locked letter can't be edited either, which matches resumes.
  - Blank resumes from New set `auto_name`, so their name follows the headline until renamed by hand. Imports are named after the person in the file (or the headline) instead of a random name.
  - Letter saves now bump `revision`.
- **App shell:** a 240 px sidebar (Rr mark, ⌘K button, Documents and Applications with counts, Trash with its count only when it holds something, New with N, and the avatar row), an icon rail with tooltips at 640–1023 px, and bottom tabs Documents · Applications · New · Account on phones. N opens New outside fields and dialogs. Settings pages keep today's layout under a tab strip until M11.
- **Documents:** a Newsreader title, All · Resumes · Letters tabs with counts, search (/ focuses it) over names, tags and linked applications, sort by edited, name or created, grid or list, and tag chips.
  - Cards show the real thumbnail (letters show a text sketch), "Resume · Edited 2h ago", the application line, a lock badge, a "New" badge until first opened (remembered per device), and a 2 px hover lift. The list shows Name, Type, Application, Edited and ⋯.
  - The same menu opens from ⋯, right-click and long-press: Open, Rename (inline), Duplicate, Copy for a job… (Link to application… for letters), Tags…, Lock or Unlock, and Move to Trash with an Undo toast. Locked documents disable the items that would change them.
  - Dropping a file anywhere on the page imports it. Loading, empty-filter and first-run states ("Let's start with what you have", with Choose a file first) are covered.
- **Trash:** back link, the 30-day note, "n days left", Restore, and "Delete now…" behind an alert dialog.
- **New dialog:**
  - Choose: Import a resume, Copy a resume for a job, Start blank, and the links "New cover letter instead" and "Try with a sample resume".
  - Importing: the file row with Cancel, three labelled steps with notes, the progress bar, then the result with the count of dates flagged for a look and Open in editor or Stay here. Failures offer Choose another file and Start blank.
  - Copy for a job: source resumes as radio rows, application chips or "No job yet", the suggested name ("{name} — {company}"), Create and open.
  - Start blank opens Write on the name field.
- **Letters** live in the Letters tab and still open in today's letter dialog (M9 moves them to the editor shell). Letter JSON imports through New → Import; a letter embedded in a resume can be copied into Documents from its entry menu (Q3k).
- **Routes:** `/dashboard` is Documents and `/dashboard/trash` is new. `/dashboard/resumes` redirects to Documents with its filters, and `/dashboard/cover-letters` to the Letters tab. The command bar gains Documents, New document, Trash and ATS Checker, and the user menu gains Settings.
- **Removed:** the old sidebar, the resumes page and its grid and list views, the create-resume and import dialogs, and the letter library page.

Differences from the plan, with reasons:

- **Trash is purged when documents are listed**, not by a daily job, for the same reason as M5's version retention: there is no scheduler and the Vercel entry skips startup hooks. Anything trashed over 30 days ago goes the next time its owner opens Documents or Trash.
- **Filtering, search and sort run in the browser** over one `documents.list` call, instead of API filters. A library is small, and filtering locally keeps the tabs, counts and tag chips instant.
- **New stays a centred dialog on phones**, not a bottom sheet. It holds a multi-step flow with a file picker, and the dialog already fits a phone screen.
- **There is no "Read as…" choice.** Every supported format is told apart by its extension, type or content, so detection is never ambiguous.
- **Grid or list is remembered per device** rather than in the URL. The URL still accepts `view=list`, so old links work.
- **Copying an embedded letter (Q3k) keeps the resume's copy.** "Copy to Documents" makes a library letter without removing the one inside the resume, so nothing on the page changes.
- **The Agents page is reachable from ⌘K only** until the assistant replaces it in M10.

Verification:

- Typecheck is clean for web, api, mcp and db.
- Tests pass: api 477, web 906, mcp 67, db 5. New tests cover the documents service (copy names, Trash and its lock rule, deleting for good only from Trash, the purge before listing, and Copy for a job's links), the name following the headline, document filters, sort, search and the Trash countdown, and import detection, parsing and summaries. Tests for the removed dialogs and pages went with them.
- knip, `turbo boundaries` and Biome are clean (this also fixed Biome findings in `index.html` from M1), and catalogs are extracted.
- E2E: updated `dashboard-lifecycle` (rename, duplicate, Trash, restore and delete now), `lock-resume`, `cover-letter-library`, `json-export-import`, `preview-direction`, `section-recovery` and `auth`; `resume-views` became `documents-views`. Added `documents-new`: Start blank naming the resume after its headline, and Copy for a job linking the copy to its application.
- The full suite passes against the dev server except the known dev-only server-PDF steps (33 passed, 7 opt-in diagnostics skipped). `hyphenation`, `public-resume-locale`, `documents-new`, `dashboard-lifecycle`, `cover-letter-library`, `json-export-import` and `share-history` pass against the production build.

### M7 · Check (done 28 Sep 2026)

What changed:

- **Live checks (`packages/resume/src/ats`):**
  - Every rule has a category: contact details, dates, layout, section headings or writing. The report scores the applicable rules (the English heading rule applies to English resumes only) as passed ÷ applicable × 100, per category too.
  - Findings get a key that uses entry ids instead of array indexes, so reordering keeps it.
  - New rule `TWO_COLUMN_LAYOUT` (C4): a two-column template printing a sidebar.
- **Check state:** `metadata.check = { ignored, hiddenTerms }` in the resume data (§3.9). It's optional, so existing resumes don't change, and public viewers don't receive it. Ignored findings don't count against the score.
- **Panel:**
  - The 84 px score ring (accent, or warn below 80) eases to each new score. Next to it: the verdict, "n of m checks pass · n things to review" and "Live · updates as you edit".
  - Tabs: Issues (n) · Job match (x/y) · Writing.
- **Issues:**
  - Numbered cards with category, title, a plain explanation and the fix, pinned to their block on the page with a numbered warn pin and a wavy underline. Picking a card or a pin outlines both.
  - One-step fixes apply with an undo toast, and the score and badge update at once:
    - https:// for a link;
    - hide the photo;
    - one column;
    - move to the main column;
    - add to page 1;
    - the standard heading;
    - minimum type size, line height or margins;
    - Switch to one column.
  - The other issues open their field in Write.
  - Show on page and Ignore (Keep for the two-column issue). "n issues are ignored · Show them again" brings them back.
  - Category rows with "n of m" or "n to review", open when they need attention.
  - The limit statement.
  - "Also check the exported PDF" runs the PDF engine and reports in a toast, with its full report behind Show.
- **Job match:**
  - It reads the posting of the application the resume is linked to (`resume.application_id`, now returned by `resume.getById`).
  - Without one (C2): link an application, or paste a posting for this visit. A pasted posting can be saved as an application, which links it. A linked application without a posting takes one here.
  - "x of y posting terms appear · not scored". Missing terms ask first ("appears n× in the posting"), then offer Add to Skills or "Not true for me, hide it"; hidden terms persist with Show again. Covered terms tint their entries on the page.
  - Terms show as the posting writes them ("C#", not "csharp").
- **Writing:**
  - An opt-in AI review. Before it runs it says what it sends and to which provider, with Change.
  - `ai.atsReview` takes the resume's bullets and paragraphs as passages. Rewrites of them come back as proposals; other advice shows as notes with impact and Show on page. "What's working" and "A model's opinion, not a verdict" follow.
  - Errors stay in the tab (C3), with Retry and Open AI settings.
  - Without a provider, the tab explains that and links to settings.
- **Proposal core** (shared with M10):
  - Proposals target one passage, a whole `<p>` or `<li>` block. They're out of date once the passage has changed.
  - While Writing is open, the page shows each pending proposal: old text struck through, new text highlighted, and a numbered accent marker in the margin.
  - Accept, Reject, Accept all (one undo step), A/R on the focused edit, and ↑/↓ between edits. After an undo they show as pending again. Out-of-date ones offer Suggest again.
- **Parser view:** "What a person sees / What a parser reads" floats over the canvas and switches instantly. The parser view reads the PDF on the page as a parser does: the text layer and column count, the fields it finds (name, email, phone, location, links, sections, dates), then the text in reading order under the headings it recognises. Lines and fields behind open issues are flagged.
- **Phones and tablets:** on phones, Show on page switches to the page with an "Issue n of m" bar (‹ ›) and the fix below (B2), and card buttons are touch size. On tablets the pins stay on the page, and tapping one opens the drawer on its card.
- **DOCX (deferred from M4):** pages print as they do in the PDF. One-column templates print their sidebar sections after the main ones instead of in a two-column table, and full-width pages print no sidebar.
- **Removed:** the builder's ATS section and deep-check UI, and the old finding messages and jump targets.

Differences from the plan, with reasons:

- **PDF-engine findings aren't pinned to the page.** The deep check reports in a toast and shows its full report on request. Mapping its evidence boxes onto the page waits for Forme.
- **Issue cards carry no AI rewrites.** No live check needs one: the mechanical checks either have a one-step fix or need the author's words. Rewrites come from the Writing tab.
- **The Writing category holds one check** (roles without a description). Wording judgements live in the Writing tab, as the spec's category description says.
- **Proposals replace a passage (a bullet or paragraph), not a whole field.** This keeps two proposals in one description independent: accepting one doesn't put the other out of date.
- **Proposal marks and markers show while Writing is open;** issue pins show on the other tabs. Pins and markers would otherwise sit on the same margin.
- **Hidden terms belong to the resume**, not to one posting, as §3.9 stores them.
- **"Ask the assistant to work it into a bullet"** arrives with the assistant in M10.
- **Resolved cards disappear at once** instead of collapsing over 200 ms. The remaining cards renumber, as the spec says.
- **Phones scroll to the issue** rather than zooming to it.
- **Found and fixed:**
  - The live checks treated a full-width page's sidebar as main-column content. Templates print no sidebar on full-width pages, so sections placed only there never printed and no check said so. They are now reported as never printing.
  - The review prompt filled its placeholders one after another, so resume text that looked like a placeholder was replaced. It now fills them in one pass.

Verification:

- Typecheck is clean for web, api, resume, schema, mcp, ai and docx.
- Tests pass: resume 1321, schema 236, api 480, web 888, mcp 67, ai 40, pdf 1056, docx 80. New tests cover:
  - categories, scoring, keys, ignores and the two-column rule;
  - issue numbering, targets and each one-step fix;
  - passages, proposals (apply, out of date, undone, marks) and review mapping;
  - the proposal list (A/R and arrow keys, Accept all as one undo step, out of date);
  - the review's passages and one-pass prompt;
  - Check state redaction;
  - how DOCX lays out each kind of page.
- knip, `turbo boundaries` and Biome are clean, and catalogs are extracted.
- E2E: added `check-mode`, which covers:
  - the pin, a fix with undo, and Ignore kept across a reload, then Show them again;
  - the parser view;
  - a pasted posting with a hidden term;
  - Writing without a provider.
- The full suite passes against the dev server except the known dev-only server-PDF steps (35 passed, 7 opt-in diagnostics skipped). `check-mode`, `hyphenation`, `public-resume-locale`, `share-history`, `documents-new` and `json-export-import` pass against the production build.

### M8 · Applications (done 28 Sep 2026)

What changed:

- **Data (§3.7):**
  - Applications end in a `closed` stage with a reason: not selected, withdrew, accepted another offer, or no response.
  - The migration moves `rejected` to closed + not selected and archived applications to closed, and rewrites `rejected` in stage history. `rollback.sql` reverses it for older versions.
  - `archived` stays, deprecated. The API still accepts `rejected` and reads it as closed.
  - New columns: `closed_reason`, `cover_letter_id` (backfilled where exactly one letter was written for the application), `sent_resume_version_id`, `sent_check_score` and `requirements`.
  - Once an application with a linked resume reaches Applied, the resume is saved as a "Sent to {company}" version, and the application keeps the version and the resume's Check score then.
- **Posting reader:** `applications.ai.parsePosting` reads a pasted link or posting.
  - Links are fetched on the server: https only, addresses checked at connect time, three redirects, 2 MB and 10 s at most.
  - A page's own JobPosting data fills role, company and location without AI. With a provider, the model reads role, company, location, salary and requirements.
- **Page:** the header has Import/Export CSV behind one icon and Add application. Below it:
  - the follow-up nudge for the application waiting longest without a reply (10+ days), dismissible per device;
  - List · Board · Insights · Calendar;
  - search across role, company, location, contacts and tags;
  - Show closed.
- **List (the default):** grouped Interview, Offer, Screening, Applied, Saved, then Closed, with collapsible groups.
  - Columns: Role, Next step (warn when overdue), Stage, Sent ("None" in warn once sent without documents) and Updated.
  - Headers sort within groups. Row checkboxes select for Move to…, Add tag, Close… and Delete…
  - Phones get two-line rows ("company · next step").
- **Board:** a column per stage (Closed when shown). Dropping tints the column, and a drop and Move to… show the same toast.
- **Detail sheet** (480 px; full screen on phones):
  - The header links View posting (its text and requirements, or the link) and has ⋯ with Edit details… and Delete…
  - The stepper is clickable, followed by the current stage, its duration and Move to {next}.
  - NEXT STEP: the next interview or follow-up, with Edit (schedule an interview or set the follow-up) and Add to calendar (.ics). It is in warn when overdue.
  - WHAT YOU SENT:
    - Open goes to the version that was sent, in History, read-only, with Back to now. The builder takes `?version=` for this.
    - Tailor a resume opens Copy for a job with the application picked. Write a letter creates a linked letter with the recipient filled in.
    - Uploaded PDFs sit under "Attach a file instead".
  - Salary and source edit in place. Applied, and Contact, which opens the contact list.
  - Tags; notes that save as you type; the activity timeline, with each row's ⋯ for edit and delete.
  - Footer: Close application… takes a reason (Reopen when closed).
- **Add dialog:** paste a link or posting. Its role and company fill editable fields, with what was found stated. The stage is a segmented Saved · Applied · Interview. Add, or Add and tailor a resume.
- **Insights:** how far applications get, counted from stage history (closed ones included), then heard back %, median days to first reply and tailored against base resumes. The existing pipeline chart (with PNG export), weekly chart and sources chart follow (Q3p).
- **CSV:** import shows how each column was matched, changeable, before saving, and the skipped rows can be downloaded. Export adds the closed reason.
- **Elsewhere:** job pickers (New → Copy for a job, Link to application, Job match) and the sidebar count leave out closed applications instead of archived ones. Sent versions are titled "Sent to {company}" in History.
- **Removed:** the table view (replaced by the list), Mark rejected and Archive.

Differences from the plan, with reasons:

- **Sent letter versions come with M9.** Letters get versions there, so `sent_cover_letter_version_id` is added then; for now the linked letter opens as it is.
- **Prepare for next step waits for the assistant (M10).** Until M10 replaces it (Q3i), the application copilot stays at the foot of the sheet, keeping the fit score and drafts.
- **Edit details… keeps the old form** for company, role, location, link, posting and the linked resume. Salary, source, contacts, tags and notes edit in the sheet itself.
- **Reopen moves a closed application back to Applied.** The spec doesn't say how to undo closing.
- **Links must be https.** Job pages are, and the AI base-URL flag that allows http is for self-hosted models, not for pages.
- **The page's own job data is read without AI**, so a pasted link fills role and company for everyone. The plan left the fields empty without AI.
- **Heard back counts a rejection as a reply**, as the spec's copy implies; median days runs from the first stage at Applied or later to that reply.
- **The Stage and Sent columns don't sort:** grouping already orders by stage.
- **Empty groups are hidden** in the list.
- **The board and calendar give way to the list on phones**, and the calendar keeps its old styling apart from the new stages.
- **Found and fixed:** choosing an editor mode replaced the builder's whole search, which would have dropped other parameters. It now keeps them.

Verification:

- Typecheck is clean for web, api, schema, db and mcp.
- Tests pass: api 489, web 899, schema 236, mcp 67. New tests cover:
  - the closed reason and reopening;
  - sent-version snapshots (once, and only when sent);
  - the posting reader: link safety, public addresses, page text and JobPosting data;
  - next-step derivation, `.ics` output, the outcome insights;
  - CSV column matching and skipped rows;
  - sent-version titles;
  - the page's search and closed filtering.
- The backfill and `rollback.sql` were checked in a transaction on sample rows.
- knip, `turbo boundaries` and Biome are clean, and catalogs are extracted.
- E2E: rewrote `applications-tracker` (add from a posting, move, note, close with a reason, Show closed; CSV import with the column match, then a bulk close) and updated `applications-export`.
- The full suite passes against the dev server except the known dev-only server-PDF steps (35 passed, 7 opt-in diagnostics skipped). `applications-tracker`, `applications-export`, `check-mode`, `documents-new`, `hyphenation` and `public-resume-locale` pass against the production build.

### M9 · Cover letters on the editor shell (done 28 Sep 2026)

What changed:

- **Data (§3.8):**
  - Letters have a `layout`. New letters are structured: the recipient's name or team, company and date, a greeting from the name ("Dear Dana," or "Dear hiring team,"), the body and a sign-off over the sender's name. Existing letters stay freeform and read exactly as before.
  - `sender_linked` and `design_linked`: a letter made with a resume takes its sender details and design live from it, resolved when the letter is read. Unlinking keeps them exactly as they read at that moment. Existing letters are unlinked copies, as before.
  - `cover_letter_version` mirrors resume versions: one per editing session (refreshed every two minutes), named, before-restore, restored and sent, with the same retention. Restoring keeps the current state as "Before restore" first.
  - `application.sent_cover_letter_version_id`: when an application reaches Applied, its letter is saved as a "Sent to {company}" version alongside the resume.
- **Letter editor** at `/builder/letter/$coverLetterId`, on the editor shell with Write and Design (no Check):
  - The bar: back, the name with its menu (Rename, Duplicate, Lock, Move to Trash) and save state, History, Share and Download PDF.
  - FOR: the application card with Change, or Link an application. Linking fills the recipient from its company and first contact, and makes this the application's letter.
  - TO: Name or team, Company and Date, with the note. FROM: the resume and "Use details from '{resume}'".
  - The body, with the greeting above it and the sign-off below. Empty, it offers Draft from the posting or Write it myself.
  - Length: the word count against the shaded 180–320 band, with the hints. DESIGN: what the letter looks like, with "Change it in Design."
  - The page shows the letter as it prints. Clicking the sender's header leads to From, and clicking the letter leads to the body.
- **Draft from the posting:** a streaming endpoint (no Redis) drafts the body from the linked resume and the application's posting, using only their facts.
  - The draft streams onto a green wash, beside the body, never in it. The dark chip "Draft · uses only your resume and the posting" offers Keep, Shorter, More personal and Discard.
  - A failure says "Drafting stopped: {provider} didn't respond. Nothing on the page changed." with Try again. Reduced motion shows the whole draft at once.
- **Design:** "Match '{resume}'" is on by default, with a link to change the resume's design. Turned off, the letter keeps its own design, starting with its template (hover previews it on the page).
- **Share & export:** Download (PDF, Resume + letter as two PDFs named to match, Word, Markdown, JSON) and History with the same timeline as resumes.
- **C2:** a linked letter says once, per device, when details it takes from the resume changed ("Your phone number changed on the resume. The letter updated too.").
- **Resume Download:** "Also download the {company} cover letter" when the resume's application has a letter; it comes in the same format.
- **Elsewhere:**
  - Documents opens letters in the editor, and old `/dashboard?letter=` links redirect there.
  - Applications' Write a letter creates a structured letter and opens it. Open goes to the version that was sent, like resumes.
  - Copy to Documents offers Open. The copilot's drafted letter opens in the editor.
  - MCP's letter tools take the structured fields and links.
- **Removed:** the letter library dialog and editor (`apps/web/src/features/cover-letters`), and "Attach PDF" to an application (replaced by linking, as the spec says).

Differences from the plan, with reasons:

- **The body is edited in the panel (Q10 fallback, as agreed).** The page updates as you type. On phones, Write shows the panel and Page shows the letter, so there's no tune sheet or keyboard toolbar; Improve arrives with the assistant (M10).
- **The greeting, sign-off and date follow the app's language**, not the letter's page language: they're composed in the browser from the app's catalogs.
- **Letters have no public link.** Share opens Download and History. The prototype's "letters can have their own link" was a placeholder with no data behind it.
- **An unlinked letter's Design is its template**, as the old editor offered. Type, color and page presets for letters wait for Forme.
- **Restoring a letter version keeps its links**, so linked details and design keep coming from the resume.
- **Links end with the resume:** once the resume is deleted for good, the letter reads from its copies and shows as unlinked.
- **A new letter from Documents takes the most recently edited resume** for its details and design.
- **Moving a letter to another application moves it as that application's letter** (from its FOR card or Documents' Link to application). A new letter becomes its application's letter only when the application has none.
- **Drafting is offered while the body is empty**, as in the prototype, and needs an AI provider (otherwise it links to AI settings). While streaming, Stop cancels it.
- **Azurill shows no sender header on letters:** its header lives in the sidebar, which a letter's full-width page leaves out. Waits for Forme.
- **Found and fixed:**
  - Letters printed without the sender's header, because the semantic tree ignored the header option. This was a one-line fix in `packages/pdf/src/document.tsx`. It also fixes "Include the resume's header" for letters inside resumes.
  - The letter integration tests had not run cleanly since M5: their setup applied only the first letter migration.
  - MCP described deleting a letter as permanent; it moves to Trash.

Verification:

- Typecheck is clean across the workspace.
- Tests pass: api 493 (plus 10 opt-in integration tests, all passing against a disposable database), web 901, resume 1323, pdf 1056, mcp 67, schema 236. New tests cover:
  - greeting derivation and structured composition, including that freeform letters are unchanged;
  - sender and design link sync, unlinking, resume deletion, application linking and History (session, named, sent, restore);
  - the draft prompt, streaming and provider failure;
  - length hints;
  - the editor store's autosave, conflict, Keep and Discard.
- knip, `turbo boundaries` and Biome are clean, and catalogs are extracted.
- E2E: replaced `cover-letter-library` with `cover-letter-editor`. It covers writing a letter for an application (recipient, greeting, body, length, rename), downloading PDF and JSON, opening it from the application and the old link, and naming, restoring and copying into a resume.
- The full suite passes against the dev server except the known dev-only server-PDF steps. Six specs that timed out under full parallel load pass when rerun. `cover-letter-editor`, `applications-tracker`, `share-history`, `documents-new` and `json-export-import` pass against the production build.

### M10 · Assistant (done 29 Sep 2026)

What changed:

- **One assistant, in the editor.** The Agents pages, the builder's assistant sheet and the application copilot panel are gone. The assistant opens beside the resume or letter it works on:
  - at 1280 px and wider, as a 400 px third column;
  - from 1024 to 1279 px, in place of the left panel;
  - below 1024 px, as a right drawer;
  - on phones, full screen.
  - The ✦ button in the bar and ⌘J toggle it.
- **Panel:**
  - Header: the model chip (tested providers only), New conversation, Past conversations and Close.
  - Empty state: four suggestions that fit the document. There are resume and letter sets, plus the tailor suggestion when an application is linked.
  - Thread: streaming, with Send turning into Stop. After a stop it says "Stopped. No edits were proposed." and offers Continue.
  - Clarifying question cards: answer by choice or in your own words, and the answer continues the reply.
  - Change sets: the Check card, with Accept, Reject, Accept all and Suggest again, plus the page marks, the "n proposed" pill in the outline and the page caption.
  - Composer: context chips (the document, and the posting) that decide what the next message shares; a two-row textarea; attachments; and the disclosure naming the provider.
  - Copy transcript under the conversation.
- **Server:**
  - Threads belong to a resume or a letter (`agent_threads.cover_letter_id`). Each thread counts its edits proposed and accepted, which past conversations show.
  - `propose_edits` rewrites or adds passages by id, and its targets are resolved against the document as it is now. Statuses are stored with the message, so a reopened conversation shows what was accepted.
  - `read_resume` and `read_letter`, `ask_user_question`, `read_attachment` and provider web search remain. `apply_resume_patch`, approvals, revert and archive are gone.
  - The system prompt names the document and includes the linked posting with the application's notes.
- **States:**
  - D1: connecting OpenAI, Anthropic or an OpenAI-compatible provider in place, through the providers API and its test.
  - D2: the error keeps the message and offers Retry and Switch model. Retrying a failed answer resends it rather than regenerating.
  - D3: past conversations, grouped by document, with outcomes ("2 of 3 edits accepted").
  - D4: stale proposals show as out of date and never apply.
  - Without `ENCRYPTION_SECRET` the assistant says it isn't set up on this server.
- **Inline Improve** in every rich-text field: Improve in the toolbar opens "Improve selected line" (Stronger verb, Add a result, Make it shorter, Ask for something else…).
  - The suggestion card offers Replace or Keep mine. Suggestions that state something new say "Check it's accurate."
  - Replace changes only that line, and only if it hasn't changed meanwhile.
  - It is served by a new `ai.improve` endpoint.
- **Outside the editor:**
  - ⌘K → Ask the assistant opens the document edited last with the question sent. In the editor, it asks about the open document.
  - Job match's missing terms offer "Ask the assistant to work it in", which asks first.
  - Applications' Prepare for next step opens the application's resume or letter with the fit, follow-up and interview suggestions (Q3i).
  - Copy for a job opens the copy with the assistant ready.
  - `/agent`, `/agent/new` and `/agent/$threadId` redirect to the document with the assistant open, or to Documents.

Differences from the plan, with reasons:

- **Redis is optional (Q11).** Without it replies stream directly, and a reply interrupted by a reload can't be picked up again.
- **The letter assistant.** Letters get the same assistant and proposals. Accepting an edit to a letter offers Undo in the toast, since letters have no undo stack; for resumes, Accept all is one undo step.
- **`?assistant=` and `?ask=` are consumed on open** and removed from the URL, so a reload doesn't send the question again.
- **Page marks carry no numbers, and cards have no "View".** Edits are marked on the page while the assistant is open, counted in the caption and pilled in the outline; each card names where its passage sits.
- **"Ask for something else…" asks inline** in the Improve menu rather than moving to the assistant, so the field keeps its place.
- **Share is an icon below 1280 px**, in both editors, so the bar fits beside the assistant column at 1024.
- **The copilot's API endpoints stay** (match score, drafted messages, tailoring) for MCP and API users; the web app uses the assistant instead.
- **Dropped per Q3j:** AI-draft copies, blank drafts, token counts and archiving. Attachments, web-search sources and Copy transcript remain.
- **Found and fixed:**
  - `docs/spec.json` and the JSON Resume schema guide had fallen behind (cover-letter routes from M9, Check metadata from M8). They are regenerated, and the OpenAPI test lists the new letter routes.
  - `react-resizable-panels` and `@shadcn/helpers` were unused in the web app, and are removed.

Verification:

- Typecheck, knip, `turbo boundaries` and Biome are clean across the workspace, and catalogs are extracted.
- Tests pass: api 485 (plus 10 opt-in), web 881, resume 1328, ai 32, server 126. New tests cover:
  - the proposal lifecycle, including going out of date after a manual edit and pending again after undo;
  - additions as new list items;
  - letter passages and ids;
  - outline pill counts;
  - removing a context chip, which leaves the document and posting out of the request;
  - the Improve prompt and output;
  - the thread's document and read-only state;
  - edit statuses carried across saves;
  - streaming without Redis.
- E2E: `assistant.spec.ts` runs against a scripted OpenAI-compatible provider (`fixtures/ai-stub.ts`). It covers:
  - connecting in place;
  - propose, accept and the persisted change;
  - the question card and its continuation;
  - Stop;
  - Improve and Replace;
  - ⌘K Ask from Documents;
  - the `/agent` redirects.
  - It needs `FLAG_ALLOW_UNSAFE_AI_BASE_URL=true` (set in the E2E workflow) and skips without it.
- The full suite passes against the production build, and the assistant spec passed three runs in a row.

### M11 · Settings and public pages (done 29 Sep 2026)

What changed:

- **Settings** in three pages, Account, Preferences and AI & developer:
  - Layout: an in-page nav (220 px, with the version, Docs, Source and Donate at the bottom) beside a 680 px column; sections divided by rules, with no cards.
  - Tablets get the nav as tabs. On phones the Account tab opens a three-row root showing each page's current value, with Help & docs and Sign out.
  - Old addresses redirect: profile and authentication go to Account; api-keys, integrations and job-search go to AI & developer.
- **Account:**
  - Profile: photo (upload or remove), then Name, Username (with the instance host) and Email, each saving when the field loses focus. Invalid or failed values stay, with the reason under them.
  - Sign-in & security: Password (Change, or Set a password), a Two-step verification switch leading to the existing flows, Passkeys (add, name, remove) and every enabled sign-in provider (Q3o).
  - Your data: Export everything, and Delete account. The delete dialog counts documents, applications and API keys, and asks you to type "delete"; Keep account cancels.
  - Sign out.
- **Preferences:** Light, Dark and System tiles; the interface language with Help translate; the motion note.
- **AI & developer:**
  - Provider rows show the model and the key's last four characters, with Test ("Connected · 420 ms" or the provider's exact error) and Edit. Edit holds the name, model, base URL, a new key, the "Use this provider" switch and Delete. Add provider lists all 16.
  - API keys: a table with Created, Last used and Expires. New key offers 30 days, 90 days or Never and shows the key once with Copy. Revoke has Undo.
  - MCP server: the address with Copy, and the setup guide.
- **Account export:** the API now includes applications, and the browser zips everything: `account.json`, each resume and letter as its own file, and `applications.json`.
- **Shared resume:**
  - Desktop and tablets: a 64 px bar (name, headline and city, Copy link, Download PDF), the page on the sunken canvas, and the footer credit.
  - Phones: the resume as text in print order, in the template's colour, with contact details as tap targets and Download and Share pinned.
  - Off, unknown and trashed links read "This resume isn't shared right now." with nothing about the owner.
  - With downloads off, Download is hidden and printing shows a note.
- **ATS checker:**
  - Idle: a drop zone with Check a sample file and an optional posting. Busy: three labelled steps.
  - Result: the 440 px column (the ring, the categories to fix, the posting's missing terms, the CTA and Check another file) beside the Original page / As software reads it lens.
  - Fix these in the editor signs a visitor up, imports the same file and opens Check.
- **Removed:** the six settings pages and the API key dialog; the public checker's AI review (Q3l), its locked card, the marketing parse preview and the old uploader; the unused theme combobox and dashboard header.

Differences from the plan, with reasons:

- **The settings root is phones-only.** From 640 px, /dashboard/settings opens Account (redirected before render). Tablets show the three pages as tabs above the column.
- **"Last changed" for the password is the sign-in record's last update.** Better Auth doesn't record password changes separately.
- **Test latency is timed in the browser**, so it includes the round trip through the server, which is what the user waits for.
- **Rows say "Model …", not "Default model …".** The app uses the most recently used tested provider rather than a chosen default.
- **Revoke turns the key off at once and deletes it when the Undo toast closes.** If the tab closes first, the key stays off and hidden.
- **The delete dialog counts documents in Trash too**, because they're deleted as well.
- **The reflow reads its order from the semantic tree but its values from the resume**, so it stays in print order without a second renderer. Rich text is parsed into an allowlist of elements, because resume HTML isn't sanitized on save. The template's body font applies only where the browser has it; loading resume fonts on the page waits for Forme.
- **Phones use the system share sheet** where there is one, and copy the link otherwise.
- **As software reads it shows the extracted text without highlighting a span**, because the analysis doesn't locate one.
- **The checker's copy follows Q9**: "Up to 25 MB · checked in your browser, never uploaded". The sample file is the Onyx template preview.
- **The checker's import reads the PDF in the browser even when an AI provider is set up**, so the issues in Check line up with the file that was checked.
- **The checker's honesty panel is gone** with the old layout. Its key line stays under the score: it reflects extraction, not your chances.

Verification:

- Typecheck, knip, `turbo boundaries` and Biome are clean across the workspace, and catalogs are extracted.
- Tests pass: api 485 (plus 10 opt-in), web 885, server 126. New tests cover:
  - the export zip's contents;
  - revoke and undo;
  - provider test formatting and the key ending;
  - public page states: downloads off, phones, and the credit with and without sign-ups;
  - reflow order against print order, with hidden sections and entries;
  - the rich-text allowlist.
- E2E:
  - New: `settings`, `shared-resume` and `ats-checker` (the sign-up and import path).
  - Updated: `public-download-preference` and `root-public-resume`.
  - The full suite passes against the production build: 42 passed, 7 opt-in skipped.
- Docs: the guides name the new settings pages, the key flow, the export's contents and the new checker.

### M12 · Responsive pass, accessibility audit, cleanup (done 29 Sep 2026)

What changed:

- **Accessibility audit:**
  - `@axe-core/playwright` (Q8) runs against WCAG 2.1 A and AA on these screens, in light and dark:
    - the editor's Write, Design and Check;
    - the assistant, and both Share & export tabs;
    - Documents and New, the letter editor, the command palette;
    - Applications (list and board) and the three Settings pages;
    - the shared resume, the ATS checker and sign-in.
  - It runs again at phone width on the editor, Documents, Applications, the settings root and the shared resume. Everything passes.
  - Fixed along the way:
    - The resume and letter canvases are focusable, labelled regions, so the page scrolls from the keyboard even before its lines load.
    - A checked switch row's description, and the checked download format's extension, step up to ink-2. Ink-3 measured 4.47:1 on the accent tint.
    - The phone reflow darkens a template colour that's too faint to read on white.
- **Keyboard and focus:** a spec opens the Share sheet, the assistant, New and the command palette from the keyboard and checks that closing each returns focus to what opened it. Closing the assistant didn't, and now does.
- **Touch targets:** on coarse pointers, buttons, switches, checkboxes and tabs get an invisible hit area of at least 44 × 44 around them (a `touch-target` utility), without changing how they look. Inputs already grow to 44 px on touch.
- **Reduced motion:** the theme and `MotionConfig reducedMotion="user"` already cover it; the audit runs with reduced motion on.
- **Responsive pass** on an iPad (portrait and landscape) and a phone, across the editor's modes, the sheets, the assistant, Documents and Applications:
  - The ✦ button was missing below 1024 px, where the assistant opens as a drawer or full screen. It now shows in every layout, in both editors.
  - In tablet portrait the bar overflowed. Download PDF there is its accent split button without the label.
- **Cleanup:**
  - The shadcn colour aliases are gone. Every class uses the Desk & Paper token it resolved to, and text colours use their text tokens.
  - The app chrome uses Material Symbols instead of Phosphor: auth pages, dialogs, the command palette, the user menu, Applications, the rich-text toolbar, the stylesheet editor and the error screens. The icon subset grew to 151 glyphs.
  - Removed:
    - the agent chat primitives (attachment, bubble, empty, marker, message, message scroller, questionnaire), the sidebar and resizable components, and their dependencies (`react-resizable-panels`, `@shadcn/react`);
    - the unused rich-text form field.
  - knip, `turbo boundaries` and Biome are clean.

Differences from the plan, with reasons:

- **The redirect stubs stay**, per Q2: through 6.0.x, and they go in 6.1.
- **Phosphor stays where it isn't chrome:** brand logos in sign-in, the landing page, and the icons printed on resumes (section icons and the icon picker). IBM Plex is used only by the landing page, which the spec leaves as it is.
- **The Notes dialog keeps the full rich-text editor**, now with Material icons. Its tests guard the shared editor extensions (indentation, tables, literal whitespace).
- **Touch targets grow invisibly** rather than making every phone control 44 px tall, so the designed density holds.
- **The §3.10 contract steps are not part of this milestone**, as planned.

Verification:

- Typecheck, knip, `turbo boundaries` and Biome are clean across the workspace, and catalogs are extracted.
- Unit tests pass in every package. Under a combined `test` + `typecheck` turbo run, a few cold-import tests (auth, api download routing, tooling catalog sync) can time out; they pass when their package runs alone.
- E2E:
  - New: `accessibility` and `keyboard`.
  - The full suite passes against the production build: 46 passed, 7 opt-in skipped.

---

## 13. Forme engine migration

Decided 29 Sep 2026: react-pdf is replaced by [Forme](https://www.formepdf.com/) 0.25.0 in a full cutover, and Semantic CSS is ported to it.

The known 0.25.0 defects are accepted until upstream fixes them (the full list is in the log below):

- Extracted text drops the second letter of ligatures ([#156](https://github.com/danmolitor/forme/issues/156)). This one gets a workaround: ligature features are switched off in the bundled font bytes.
- Arabic, Hindi and Hebrew extracted text is scrambled.
- A link inside part of a paragraph loses its annotation ([#157](https://github.com/danmolitor/forme/issues/157)).

### Shape

- **Host primitives.** `packages/pdf/src/forme/primitives.tsx` exports react-pdf-compatible `Document`, `Page`, `View`, `Text`, `Link`, `Image`, `Svg`, `Path` and `StyleSheet`. The `#react-pdf-renderer` import alias points at it, so templates keep their structure.
- **Renderer.** A small `react-reconciler` renderer builds the host tree. Hooks and context keep working, which Forme's own serializer can't do because it calls components as plain functions.
- **Conversion.** The host tree becomes Forme elements. On the way, styles are normalised, `Link` becomes `href`, and `Svg` becomes markup. Nodes tagged `data-resume-node` are registered in `globalThis.__formeSourceMap`, so Forme's layout info yields the page map for click-to-edit, Check and Fit.
- **Rendering.** `@formepdf/core` renders in Node; the browser uses `@formepdf/core/worker` with explicit WASM init. One `renderResume()` returns the PDF bytes, the page map and warnings.
- **Fonts.** The bytes are fetched once and cached. WOFF is inflated to sfnt, and the GSUB `liga`, `clig` and `dlig` features are renamed so the shaper skips them (the #156 workaround). Fallback families become a Forme fallback chain.
- **Rich text.** `react-pdf-html` is replaced by a small `Html` renderer in `packages/pdf/src/text.tsx` with the same contract (per-tag renderers, tag and class stylesheet, inline runs grouped into one text).
- **Icons.** Phosphor icons are generated as SVG markup from `@phosphor-icons/react`, replacing `phosphor-icons-react-pdf`.
- **Semantic CSS.** The language is unchanged, so saved stylesheets keep working. Resolved styles flow through the same conversion as template styles. Declarations Forme can't draw raise an `ENGINE_UNSUPPORTED` warning in the stylesheet editor: `z-index`, `max-lines`, `text-indent`, `vertical-align`, `object-position`, `text-decoration-color`/`-style`, `-resume-min-presence-ahead` and dashed or dotted borders. `object-fit` is drawn by the converter.
- **Free-form pages.** They render in two passes: measure the content height, then render at that height.
- **Removed:** `@react-pdf/renderer`, `@react-pdf/hyphenate`, `react-pdf-html`, `phosphor-icons-react-pdf`, and the four react-pdf patches. Hyphenation uses Forme's `hyphens` and `lang`.

### Phases

1. Engine core: primitives, reconciler, conversion, fonts, render entry points and the page map, proven on Onyx.
2. Templates and shared primitives: icons, rich text, pictures, page backgrounds and free-form pages, across all 15 templates.
3. Semantic CSS adapter and diagnostics.
4. Consumers: the web preview and exports, the template gallery, the server export and public PDF, and the ATS deep check. Remove react-pdf.
5. Tests: port the render and integration tests to Forme; drop the react-pdf-internal tests.
6. Verification: typecheck, unit tests, e2e, extraction checks and a visual pass across templates.

### Log

Done on `redesign/forme-engine`, 29 Sep 2026, in three local commits. All phases are complete.

- **Result:** `@react-pdf/*`, `react-pdf-html`, `phosphor-icons-react-pdf` and the four patches are gone (58 packages fewer). Every PDF in the app renders through `renderResume()`: preview, downloads, thumbnails, the template gallery, the public page, the server export and the ATS deep check.
- **Verification:**
  - Typecheck and `turbo boundaries` are clean.
  - Unit tests pass: pdf 985 (plus 19 expected failures), web 885, API 485, server 126, resume 1329, tooling 110.
  - E2E: 46 passed and 7 skipped against the production build.
  - All 15 templates were checked visually, LTR and RTL.
  - The ligature test fails without the #156 workaround.
- **Workarounds for Forme 0.25 defects,** all in `packages/pdf/src/forme`:
  - Translucent colours are painted opaque, so they are blended over their backdrop.
  - Borders are stroked centred on the edge, so thick ones are redrawn as an inset overlay.
  - `row-reverse` is laid out as `row`, so the children are reversed instead.
  - Absolute boxes are placed against the content box and ignore auto width and percentage offsets.
  - A text directly inside a splitting row sends later boxes to y = −1.8e308, so the text is wrapped in a box. A render that still misplaces a box is repeated with nested rows kept whole.
  - `rowGap` breaks across pages, so it becomes margins.
  - A negative top margin at a page top loses a page.
  - `minWidth` and `maxWidth` are ignored along a row.
  - A `Text` drops `View` children.
  - Empty text gets a full line.
  - Optimal line breaking overflows ragged text, so breaking is greedy.
  - Fixed bands are cut short and fall into row layouts.
  - The image fetch throws on HTTP errors, so pictures are preloaded.
  - `object-fit` is missing.
  - The SVG path parser misreads compact numbers.
  - SVG opacity leaks into later content.
  - A plain box that breaks across pages drops out of the layout info, so the page map rebuilds it from its contents.
- **Engine limits left in place** (recorded as expected failures, which pass once Forme fixes them):
  - A list marker can stay on a page its first line leaves: there is no keep-with-next.
  - RTL lines are laid out left to right and then right-aligned.
  - Characters above U+FFFF (for example 👨‍💻) don't draw.
  - Rotation is left out, because Forme moves rotated boxes; the picture's rotation option has no effect.
  - Percentage padding is left out.
  - Dashed and dotted borders draw solid.
  - `z-index`, `max-lines`, `text-indent`, `vertical-align`, `object-position` and presence hints are ignored.
  - The Semantic CSS editor warns about each of the ignored properties (`ENGINE_UNSUPPORTED`).
- **Behaviour changes:**
  - Hyphenation now follows the page language for every language Forme has patterns for; the toggle text says so.
  - Glalie's sidebar is one 36% tint band, not two stacked 20% layers, so a custom band colour shows as authored.
  - The browser renderer rejects a document whose fonts can't be downloaded, so callers fall back to the server PDF, as before.
  - `packages/pdf` compiles JSX with `react-jsx`.
- **Docs:** current-state docs, the privacy policy and the terms name the new engine. `third-party-notices.txt` credits Forme. Both the legal wording and the notices need the owner's review.

## 14. Completion (29 Sep 2026)

The items left open in §12 and §13, in the order they were done. Local commits on `redesign/forme-engine`.

- **Phone keyboard toolbar (M3 spec).** On phones the rich-text toolbar docks above the keyboard (`useKeyboardInset` follows `visualViewport`), with 44 px buttons and Done.
- **"Imported from…" note (D2).** Opening an import in the editor says what it brought in: sections, entries and dates to check. Dismissing it clears `?imported=` from the address.
- **Sidebar Left/Right.** `metadata.layout.sidebarSide` (optional, left or right) overrides a template's own side; right to left still mirrors. All eight two-column templates and the DOCX export follow it, and Design's Sidebar panel offers the choice.
- **Deep-check pins.** Findings from the exported PDF are placed on its lines (`locateEvidence`) and pinned on the page in Issues while the resume is unchanged. A pin opens the full report.
- **Azurill letter header.** Already fixed by the Forme port; a test now checks the sender header in all 15 templates.
- **Letter design.** A letter with its own design gets Type, Colour and Page, the same controls as a resume. They save with what's typed; setting them ends the design link.
- **Custom CSS editor.** Syntax colours use the app's inks, so the editor reads in dark mode. Its toolbar icons show again: an `Icon` now always draws its own glyph, whatever `data-icon` a caller passes.
- **Preview in a Web Worker.** Every browser PDF (preview, thumbnails, downloads, Check, public page) renders in one module worker. If workers are unavailable it falls back to the main thread. Forme and its 6.9 MB engine stay out of the main bundle. The worker bundle gets the Lingui plugins for translated section titles.
- **List markers stay with their first line.** Converted list items carry their index into Forme's layout. `renderResume` finds markers left on a page their first line leaves and renders again with a page break before those items (at most three passes). Eleven expected-failure tests now pass. Presence hints are still ignored.
- **Right to left:** the award title and date row mirrors like every other header row.
- **§3.10 contract steps**, listed in §3.10. Migration `20260929063245_contract_redesign_legacy_fields` has a `rollback.sql`. It was applied only to the isolated verification database.
- **Letters leave resumes.** A cover letter is a document of its own; resumes no longer hold cover-letter sections.
  - Migration `20260929071322_letters_leave_resumes` (with `rollback.sql`) saves every letter a resume carried (hidden ones too) as a letter linked to that resume's details and design, named "‹resume› — ‹section›". A resume with one letter, used by exactly one letter-less application, hands the letter to that application. The sections then leave the resumes and their layouts. Resume History keeps older versions as they were.
  - Every resume write on the server (create, import, update, patch, restore) passes through `adoptEmbeddedLetters`, in the same transaction, so a stale tab, an old file, an API client or a restored version still can't put a letter back into a resume. A letter already saved from the same item with the same text isn't saved twice.
  - Removed: adding a cover letter in the resume editor, "Copy to Documents", "Import from library", the resume Download's Cover letter tab, the `cover-letter` target of resume PDF downloads (API, signed links, MCP) and `copy_embedded_cover_letter`. The sample resume has no letter. Letters still render through the templates as a cover-letter section of their own document.
  - Letters moved by the migration are stored as they were written; the server sanitises them on their next save.
- **Knip:** the Forme port's unused exports and types are removed, and the server's engine dependencies are listed.
- **Engine limits still open** (expected failures in `packages/pdf`, which pass once Forme supports them):
  - Right-to-left lines are laid out left to right, then right-aligned.
  - Characters above U+FFFF don't draw.
  - Percentage padding is ignored.
  - Presence hints are ignored.
  - Rotation, dashed and dotted borders, `z-index`, `max-lines`, `text-indent`, `vertical-align` and `object-position` are ignored (§13).
  - These are documented here and warned about in the CSS editor; none has been reported upstream.
- **Verification:**
  - Every workspace typechecks.
  - Unit tests pass in every package: pdf 1020 (plus 8 expected failures), web, API, MCP, schema and resume.
  - Under the full parallel run, three tests with 5 to 20 s timeouts can time out; the heaviest downloads a CJK font. They pass when their package runs alone.
  - `turbo boundaries` and `knip` are clean.
  - Playwright against the production build: 45 passed and 7 skipped.
  - The dark-mode axe check failed once, on the page caption behind the Share sheet, and passed on seven reruns, including five in parallel.
