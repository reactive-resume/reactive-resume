# Reactive Resume: job application improvements

Status: proposed backlog. No implementation is included in this document.

Based on [HireSweep competitor research, October 30, 2026](../research/hiresweep-2026-10-30.md). Source-code findings refer to Reactive Resume 6.0.10 at commit `33920b2e856048f3c5951bddbc00ba9d29778f61`; recheck the current implementation before starting each item.

## Objective

Connect Reactive Resume's existing resume, career, and application tools to the repetitive work of applying: capture a posting, reuse accurate answers, prepare the right documents, fill supported forms, and retain what was submitted.

Preserve free core functionality, optional AI, portable data, self-hosting, and equivalent web/mobile features. Extend existing domain services rather than creating a separate application automation system.

## Priorities

Effort describes relative scope, not delivery time. Browser integrations require continuing compatibility work.

| ID     | Improvement                                     | Priority    | Relative effort              | Recommendation                              |
| ------ | ----------------------------------------------- | ----------- | ---------------------------- | ------------------------------------------- |
| APP-01 | Structured application profile                  | P0          | Medium                       | Build first                                 |
| APP-02 | Reusable application answer library             | P0          | Medium                       | Build first                                 |
| APP-03 | Consistent tailoring with evidence review       | P0          | Medium                       | Improve existing capabilities               |
| APP-04 | Guided application preparation                  | P0          | Small–medium                 | Connect existing workflows                  |
| APP-05 | Browser posting capture and mobile sharing      | P1          | Medium                       | First browser-assistance release            |
| APP-06 | User-triggered employer-form autofill           | P1          | Large                        | Prototype narrow site support               |
| APP-07 | Better discovery setup and explainable triage   | P1          | Medium                       | Improve existing discovery                  |
| APP-08 | Coach feedback and progress sharing             | P2          | Medium                       | Validate a narrow workflow                  |
| APP-09 | Direct ATS feeds and broader discovery coverage | Conditional | Large                        | Add after coverage evaluation               |
| APP-10 | Multi-client operator workspaces                | Conditional | Very large                   | Validate demand and ownership model         |
| APP-11 | Hosted background application execution         | Deferred    | Very large                   | Revisit after browser-assistance evaluation |
| APP-12 | Funded hosted AI service                        | Deferred    | Large operational commitment | Separate sustainability decision            |

P0: first implementation phase. P1: next phase. P2: research and a limited collaboration pilot. Conditional and deferred items are opportunities to evaluate, not committed features.

## APP-01: Structured application profile

**Problem:** resumes do not contain every answer employer forms need. Existing career preferences cover some fields, but there is no equivalent central application profile.

**Scope**

- [ ] Store application-only contact details, links, and address separately from public resume content.
- [ ] Add country-specific work authorization and sponsorship answers, including explicit unknown values.
- [ ] Reuse existing availability, location, relocation, and salary preferences where their meanings match.
- [ ] Include currency and pay period with salary answers; do not silently confuse minimum acceptable salary with requested salary.
- [ ] Support references, with explicit user entry and correction.
- [ ] Track when changeable details were last reviewed.
- [ ] Make optional self-identification answers an independently evaluated extension of the profile, with explicit consent and no inclusion in AI prompts.

**Acceptance criteria**

- Profile can be created, edited, exported, and deleted on web and mobile without AI.
- Missing answers remain unknown; no authorization, sponsorship, or sensitive answer is inferred from resume text.
- Private profile fields never appear in public resume links or document exports unless the user explicitly places them in a document.
- Application-specific overrides do not silently change global preferences.

**Likely owners:** `packages/schema`, `packages/db`, `packages/api`, web/mobile settings and Apply.

## APP-02: Reusable application answer library

**Problem:** users repeat reviewed answers across employer forms. Existing answers belong to individual applications.

**Scope**

- [ ] Add **Save for other applications** and **Use a saved answer** to Apply.
- [ ] Store question, answer, source, supporting fact/story references, last-reviewed time, and reuse scope.
- [ ] Distinguish reusable answers from employer-specific and application-specific answers.
- [ ] Support search, editing, duplicate handling, deletion, copying, and export.
- [ ] Offer relevant reviewed answers when a similar question appears; require review before adapting wording or context.
- [ ] Flag answers whose linked evidence has changed or been removed.
- [ ] Keep word/character counts and existing Draft/Tighten actions available.

**Acceptance criteria**

- A reviewed answer can be reused on a second application without another AI call.
- Company-specific wording is not silently reused for a different employer.
- AI drafts do not automatically become confirmed career facts or universal answers.
- Changing a library answer does not rewrite previously submitted application snapshots.
- Correcting or deleting evidence does not leave misleading evidence badges on saved answers.

**Dependency:** share profile and evidence contracts with APP-01; useful before any browser extension exists.

## APP-03: Consistent tailoring with evidence review

**Current behavior:** web/mobile document assistants already propose edits across resume passages. The separate `applications.ai.tailorResume` API/MCP action only rewrites the summary. This item improves consistency; it does not introduce tailoring from scratch.

**Scope**

- [ ] Standardize selection of base resume, target posting, and proposed changes across entry points.
- [ ] Keep the original resume and create a job-linked copy.
- [ ] Explain which posting requirement each substantive edit addresses.
- [ ] Show supporting resume passages or confirmed Knowledge facts where available.
- [ ] Identify proposed additions that lack support, especially skills, metrics, dates, and responsibilities.
- [ ] Let users accept, reject, edit, and undo proposals using existing document review controls.
- [ ] Present requirement coverage and missing evidence clearly; keep keyword matching separate from AI assessment.
- [ ] Add an explicitly reviewable full-document API/MCP operation if needed, preserving the existing summary-only contract.

**Acceptance criteria**

- No proposal modifies a document before acceptance.
- Changed employers, dates, figures, or skills are visible during review and are not treated as confirmed facts automatically.
- Evidence gaps remain visible rather than being filled with invented experience.
- Existing API/MCP consumers retain the behavior of the operation they call.
- Match scores are described as editing aids, not hiring probabilities or guaranteed ATS acceptance.

**Likely owners:** existing document assistant and application API features, `packages/schema`, `packages/mcp`, web/mobile assistant UI.

## APP-04: Guided application preparation

**Problem:** relevant capabilities exist, but users must connect several screens and actions themselves.

**Scope**

- [ ] Provide a clear path: saved job → base resume → reviewed tailoring → cover letter → form answers → readiness review.
- [ ] Show the resume and letter selected for that specific application.
- [ ] Reuse current assistant, letter editor, Apply workspace, and submitted-version records.
- [ ] Make copying answers and downloading the selected documents easy from the application workspace.
- [ ] Show the next useful action based on actual missing information and application stage.
- [ ] Provide a short first-application setup checklist using existing data and provider availability.
- [ ] Keep manual preparation fully usable without AI.

**Acceptance criteria**

- Users can prepare an application without repeatedly selecting the same posting and documents.
- Preparation never marks a job applied or claims an employer received it.
- Recording submission preserves the exact selected document versions and answers.
- Already submitted applications show what was sent separately from current drafts.
- Equivalent tasks are accessible on web and mobile.

## APP-05: Browser posting capture and mobile sharing

**Problem:** URL import cannot always read postings available inside a user's browser session, and manual copying interrupts the workflow.

**Scope**

- [ ] Add user-triggered browser capture of posting URL, title, company, location, and description.
- [ ] Let users review and correct extracted details before saving to the existing tracker.
- [ ] Detect an already tracked posting and offer to open or update it.
- [ ] Provide an equivalent mobile share/import workflow; a desktop extension alone does not complete this feature.
- [ ] Support connecting the helper to a self-hosted Reactive Resume installation.
- [ ] Request access only for the intended interaction and keep browser session credentials local.
- [ ] Fall back to URL or pasted-text import when capture is unsupported.

**Acceptance criteria**

- One user action captures a posting without an AI request when structured extraction suffices.
- Unrelated page content, cookies, passwords, and session tokens are not transferred.
- Extracted posting text is treated as untrusted content by downstream AI workflows.
- Capturing the same posting twice does not silently create duplicate applications.
- Users can disconnect the helper from an installation.

**Dependency:** use existing posting extraction, canonicalization, application creation, and ownership checks.

## APP-06: User-triggered employer-form autofill

**Problem:** users must re-enter contact details, work history, documents, and answers after preparing an application.

**Scope**

- [ ] Prototype a small explicit support matrix, initially considering Greenhouse, Lever, and Ashby.
- [ ] Fill recognized fields from the reviewed application profile and selected resume.
- [ ] Attach the specific resume and letter chosen for the application.
- [ ] Offer saved answers for recurring questions and ask about unresolved fields.
- [ ] Make AI drafting optional and show where supplied answers came from.
- [ ] Handle multi-page forms and custom controls only where support is verified.
- [ ] Show filled fields, skipped fields, errors, and the active document versions.
- [ ] Retain copyable answers and manual document downloads for unsupported forms.
- [ ] Keep final submission under the user's control in the initial release.

**Acceptance criteria**

- Filling a form never independently submits it or marks an application successfully sent.
- Wrong or unavailable document uploads produce a visible failure rather than silently using another resume.
- Unknown work authorization and sensitive questions require explicit answers.
- Unsupported controls and account/captcha steps have clear manual handoffs.
- Mobile has an equivalent supported flow; platform limits are resolved before claiming parity.

**Dependencies:** APP-01, APP-02, APP-05, and evaluation of mobile browser integration. Native integration may require a store build.

## APP-07: Better discovery setup and explainable triage

**Current behavior:** scheduled discovery, URL normalization, duplicate suppression, posting validation, notifications, and optional emails already exist. Current match chips primarily reflect preference phrases.

**Scope**

- [ ] Suggest editable target roles from the user's resume and enabled Knowledge when AI is available.
- [ ] Keep manual target roles and search preferences available without AI.
- [ ] Explain why a role appeared and which preferences it matches.
- [ ] Distinguish keyword overlap, preference matching, and AI fit assessment.
- [ ] Surface posting source, freshness, and unknown salary or workplace information.
- [ ] Improve track, dismiss, and bulk-triage actions without losing existing deduplication.
- [ ] Make recurring search setup, cadence, notifications, provider requirements, and failures easy to understand.

**Acceptance criteria**

- Users can revise suggested roles before a search or schedule uses them.
- Missing salary and workplace details remain unknown rather than being guessed.
- Discovery does not automatically apply to found jobs.
- Dismissed and already tracked results remain suppressed according to existing semantics.
- Results identify their source and do not imply guaranteed freshness or completeness.

## APP-08: Coach feedback and progress sharing

**Scope to validate**

- [ ] Owner-controlled sharing of a selected resume for feedback.
- [ ] Read-only access and comments as distinct permissions.
- [ ] Optional sharing of selected application progress without exposing all career data.
- [ ] Revocable links, clear shared-data boundaries, and an activity history.
- [ ] Expiry or version binding where feedback or approval depends on a particular document.

**Acceptance criteria for a pilot**

- Owner can see what is shared, with whom, and revoke access.
- Unshared applications, Knowledge, profile answers, and provider credentials remain inaccessible.
- Comments do not mutate the owner's documents automatically.
- Feedback identifies the document version reviewed.

Validate needs with career coaches, helpers, nonprofits, or university services before committing to operator workspaces. Determine whether they need feedback, editing, reporting, or delegated applications; these require different permissions.

## Conditional and deferred opportunities

### APP-09: Direct ATS feeds and broader discovery coverage

Evaluate direct employer career feeds only after measuring gaps in current search results. A feed adapter also needs employer discovery, normalization, duplicate handling, freshness checks, and maintenance.

- [ ] Compare current search providers against a fixed set of queries, regions, and known open postings.
- [ ] Identify specific coverage or freshness deficits.
- [ ] Add feed adapters only where measured gains justify their continuing cost.
- [ ] Keep retrieval behind existing provider/domain boundaries.

### APP-10: Multi-client operator workspaces

Revisit if APP-08 demonstrates demand for applying on behalf of multiple people.

- [ ] Separate client resumes, applications, profiles, and searches.
- [ ] Model membership, permissions, actor versus owner, and audit history.
- [ ] Consider ranking a posting across a client roster.
- [ ] Add explicit client approval of exact documents and answers.
- [ ] Invalidate approval when approved material changes.
- [ ] Support revocable client reports and appropriate export/deletion controls.
- [ ] Enforce permissions consistently across web, mobile, API, MCP, and background work.

This is a new ownership model. Multiple resumes or shared login credentials do not provide equivalent isolation or delegation.

### APP-11: Hosted background application execution

Defer until user-triggered browser assistance has demonstrated demand and reliable behavior.

- [ ] Evaluate operating cost, hosting compatibility, support workload, and site maintenance.
- [ ] Consider an optional external executor behind stable contracts rather than coupling browsers to the core server.
- [ ] Define per-application authority, cancellation, timeouts, duplicate prevention, and manual handoffs.
- [ ] Distinguish attempted, submitted, failed, and unknown outcomes using reliable confirmation.
- [ ] Preserve the actual document versions and answers used in each run.
- [ ] Evaluate autonomous discovery-to-submission separately from background execution of a user-selected job.

Do not assume a high match score authorizes submission or that retrying a failed browser step cannot create a duplicate application.

### APP-12: Funded hosted AI service

Administrator-provided AI already exists. The opportunity is easier onboarding and sustainable funding, not another provider integration.

- [ ] Improve explanation and discovery of existing administrator-provided AI.
- [ ] Evaluate actual provider cost, abuse controls, usage limits, and support before funding public access.
- [ ] Keep personal-provider and self-hosted use viable.
- [ ] Make any future billing or usage model explicit and avoid restricting existing free core functionality.

Credit subscriptions and funded inference require a separate business and sustainability decision.

## Cross-cutting implementation requirements

- [ ] Deliver matching user-facing behavior on web and native mobile in the same change.
- [ ] Preserve backward-compatible APIs for older mobile binaries and existing integrations.
- [ ] Put schemas and shared logic in existing workspace packages; keep feature UI in its owning app.
- [ ] Keep document rendering and browser automation separate.
- [ ] Enforce resource ownership and delegated permissions in API services, including all API/MCP entry points.
- [ ] Preserve explicit AI context controls and disclose the provider receiving data.
- [ ] Include new records in appropriate account export and deletion flows.
- [ ] Preserve submitted snapshots when profiles, answers, or documents later change.
- [ ] Support keyboard, screen-reader, localized, and narrow-screen workflows.
- [ ] Add Lingui strings and update mapped guides and fictional screenshots with feature changes.
- [ ] Assess whether mobile changes need an OTA update or a new native store build.
- [ ] Run affected typechecks/tests, package boundaries, lint, formatting, and runtime/build checks appropriate to implementation.

## Validation plan

Use synthetic career histories and controlled forms for initial evaluation. Real employer submissions are unnecessary for these checks.

| Area                | Evidence to collect                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Profile and answers | Time spent on repeated forms; correction rate; handling of stale and employer-specific answers                    |
| Tailoring           | Unsupported claims; changed names, dates, and figures; review effort; usefulness across professions and languages |
| Preparation         | Completion of one job's documents and answers; correct selected versions; accurate submission snapshots           |
| Posting capture     | Field accuracy; duplicate handling; session-data exclusion; mobile import equivalence                             |
| Autofill            | Field correctness; correct attached documents; unsupported controls; handoffs; absence of unintended submission   |
| Discovery           | Valid open postings; freshness; duplicates; preference relevance; retrieval/provider cost                         |
| Collaboration       | Useful feedback tasks; permission boundaries; revocation; demand for broader delegation                           |

Set release thresholds after baseline measurement. Higher match scores and vendor feature counts are not substitutes for measured user benefit. Use voluntary research or opt-in measurement consistent with Reactive Resume's privacy commitments.

## Suggested implementation sequence

1. APP-01 and APP-02: shared profile and reviewed answer reuse, available inside Apply on web and mobile.
2. APP-03 and APP-04: consistent tailoring and a coherent preparation path using existing editors and snapshots.
3. APP-05: posting capture with equivalent mobile sharing/import.
4. APP-06: narrow, user-triggered form filling; APP-07: discovery improvements using the current scheduler.
5. APP-08: limited coach collaboration pilot.
6. Revisit APP-09 through APP-12 only after their stated validation work.

First useful deliverable: save a reviewed answer from one application, reuse it on another, and preserve both applications' submitted answers independently.
