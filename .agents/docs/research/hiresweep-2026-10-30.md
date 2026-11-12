# HireSweep competitor research and native feature recommendations

Research date: October 30, 2026. Reactive Resume baseline: version 6.0.10, commit `33920b2e856048f3c5951bddbc00ba9d29778f61`.

## Decision

HireSweep has added a meaningful application-execution layer around Reactive Resume: reusable form answers, browser-assisted applications, hosted application runs, and workflows for people applying on behalf of clients. Its resume builder, AI editing, job tracking, fit review, discovery, and API/MCP surfaces substantially overlap capabilities already present in Reactive Resume.

Recommended investments, in order:

1. Add a reusable application profile and answer library, connected to existing Knowledge and per-job answers.
2. Make existing preparation and tailoring entry points consistent. A document assistant already tailors passages; the separate API/MCP tailoring action only rewrites the summary.
3. Build browser assistance incrementally: save a posting first, then fill common fields and attach the chosen documents, with user review and manual final submission.
4. Improve discovery setup and explainable triage using existing scheduled discovery, rather than building another search system immediately.
5. Validate small coach collaboration workflows before introducing agency workspaces.

Defer hosted unattended applications and a managed AI subscription business. Both introduce continuing operational costs and materially expand the product's responsibilities. These are product judgments, not findings of proven market demand.

## Scope and evidence quality

Reviewed HireSweep's homepage, pricing, three feature pages, recruiter landing page, comparison index, complete public documentation, public OpenAPI specification, public extension metadata, selected shipped JavaScript bundles, and Chrome Web Store listing. Compared them with Reactive Resume source for web, native mobile, API, schemas, database ownership, assistant tools, and scheduled discovery. Checked Simplify, Huntr, Teal, and LoopCV through their own product/help pages.

HireSweep's public documentation was retrievable through its [complete documentation export](https://docs.hiresweep.com/llms-full.txt), even when individual pages with trailing slashes returned errors. Search indexing was sparse; direct HTTP retrieval supplied most HireSweep evidence.

Evidence distinctions:

- **Observed:** public prices and policies; explicit source attribution; published extension listing; public API contracts; client-side interfaces shipped in public assets; Reactive Resume implementation inspected at the baseline above.
- **Documented, not exercised:** successful form filling, client approval enforcement, background submission, discovery coverage, and factuality checks in HireSweep. Published routes and UI support the presence of product work but do not establish correctness.
- **Unknown:** paying customers, revenue, retention, conversion, employer response rates, real-world application success rate, hosted browser cost, and whether automatic application starts are enabled in production.

No account was created, extension installed, private data uploaded, application submitted, or production mutation performed. No runtime quality comparison or private-source audit was conducted. “Not found” below means absent from reviewed sources, not proof a capability does not exist.

## What HireSweep is doing

### Positioning and commercial model

HireSweep sells a path from finding a role to sending an application, with the builder supporting that path. Its second audience is coaches, recruiters, and agencies running searches for multiple candidates. The commercial unit is usage credits rather than templates or client seats. Its recruiter workflow resembles candidate-side or reverse recruiting more closely than an employer's applicant tracking system. Sources: [homepage](https://hiresweep.com/), [recruiter offering](https://hiresweep.com/for-recruiters), [feature map](https://docs.hiresweep.com/getting-started/feature-map).

Public pricing observed:

| Plan        | Monthly credits | Monthly price |
| ----------- | --------------: | ------------: |
| Free        |        200 once |            $0 |
| Entry       |             700 |           $11 |
| Recommended |           2,000 |           $27 |
| Larger      |           5,000 |           $57 |
| Volume      |  12,000–100,000 |   $137–$1,140 |

Annual billing is advertised at 18% less. Monthly credits do not roll over. Paid plans can opt into extra usage at $2 per 100 credits, with a spending limit. Clients are unlimited across plans and share the operator's credit pool. Sources: [pricing](https://hiresweep.com/pricing), [plans and usage](https://docs.hiresweep.com/guides/plans-and-usage).

Credit costs are 1 for an AI action, 10 for a search that finds jobs, 10 for a browser application, and 25 for a hosted application. Building, editing, exporting, and sharing resumes are free. Thus the $27 plan's form-only upper bound is 200 local-browser applications or 80 hosted applications. Reviews, tailoring, letters, searches, and other AI requests consume the same balance and reduce those totals. These are arithmetic ceilings, not measured user costs. The apply guide also documents an exception to broad refund language: a local run left at review without cancellation can consume held credits when the hold expires. Sources: [plans](https://docs.hiresweep.com/guides/plans-and-usage), [application charging details](https://docs.hiresweep.com/guides/applying-to-jobs#what-it-costs).

Hosted AI removes provider setup for new users. Its privacy policy identifies Anthropic Claude as its hosted AI and also describes personal provider keys. Reactive Resume already supports administrator-provided AI as well as personal connections; the difference is a turnkey funded service, not a missing model integration. Sources: [HireSweep AI](https://docs.hiresweep.com/guides/using-ai), [privacy policy](https://docs.hiresweep.com/legal/privacy-policy), [Reactive Resume shared AI implementation](../../../packages/api/src/features/ai-providers/service.ts).

### Discovery and matching

HireSweep documents these steps:

- Suggest target job titles from a resume.
- Search public ATS career boards and additional job feeds.
- Triage matches as Strong, Partial, or Loose, with explanations and bulk decisions.
- Repeat daily or weekly and email new results.
- Apply location, work arrangement, salary, and other search filters.

The supported-board table distinguishes discovery, browser filling, and autonomous application support. Those are separate capabilities: finding a Workday job does not imply applying to it in a hosted browser. LinkedIn search uses the signed-in user's extension and runs on explicit searches, not recurring server searches. Indeed is described as retired. The marketing FAQ says LinkedIn is not searched, while the detailed extension and board guides describe browser-local LinkedIn search; the latter is the more specific account. Sources: [discovery](https://hiresweep.com/features/job-discovery), [discovery guide](https://docs.hiresweep.com/guides/discovering-jobs), [board matrix](https://docs.hiresweep.com/guides/supported-job-boards), [extension guide](https://docs.hiresweep.com/guides/installing-the-browser-extension).

Reactive Resume already schedules discovery, reads and verifies individual postings, canonicalizes URLs, suppresses duplicates, saves opportunities, and supports in-app and optional email notifications. Its discovery chips match preference phrases; they are not equivalent to a resume-based semantic ranking. Existing retrieval uses configurable web-access providers rather than HireSweep's documented directory/feed approach. This is a quality and onboarding opportunity, not a missing discovery feature. Evidence: [jobs](../../../packages/api/src/features/career/jobs.ts), [matching](../../../packages/api/src/features/career/matching.ts), [posting retrieval](../../../packages/api/src/features/applications/posting.ts).

### Tailoring and truthful edits

HireSweep documents a separate tailored copy, rewriting and reordering existing content, a before/after match score, and a list of edits dropped for unsupported skills, figures, or experience. Cover letters have tone choices and text/Word downloads. These are product claims; this research did not test their ability to prevent invented claims. Sources: [tailoring feature](https://hiresweep.com/features/tailoring), [tailoring guide](https://docs.hiresweep.com/guides/tailoring-and-cover-letters).

Reactive Resume already offers copies linked to jobs and assistant-generated passage edits that the user accepts or rejects, on web and mobile. The separate `applications.ai.tailorResume` endpoint, exposed through MCP, rewrites only the professional summary and then links the new copy. Its MCP description accurately describes this limitation. Do not infer that the main web/mobile tailoring workflow is summary-only. Evidence: [web assistant](../../../apps/web/src/features/assistant/assistant-panel.tsx), [mobile assistant](../../../apps/mobile/src/features/assistant/assistant-screen.tsx), [proposed edits](../../../packages/api/src/features/agent/tools.ts), [API tailoring](../../../packages/api/src/features/applications/ai.ts), [MCP description](../../../packages/mcp/src/tool-meta.ts).

Useful addition: a consistent, reviewable tailoring result across all entry points, identifying the posting requirement, proposed passage, supporting facts, and unsupported additions left out. A higher match score should remain an editing aid, not a prediction of hiring success.

### Application profile and reusable answers

HireSweep has structured contact details, country-specific work authorization, sponsorship, location, availability, salary expectations, references, voluntary self-identification, and up to 200 saved answers. Answers supplied during a run become reusable. Its policy says optional demographic, disability, and veteran answers are excluded from model requests. Source: [apply profile](https://docs.hiresweep.com/guides/setting-up-your-apply-profile), [privacy policy](https://docs.hiresweep.com/legal/privacy-policy).

Reactive Resume has overlapping career preferences, facts, stories, application-specific answers, drafting/tightening, copy/download controls, and submitted snapshots. The inspected schema does not provide an equivalent structured application profile or user-wide question/answer library. Reusing career evidence is different from reusing a reviewed answer to a recurring form question. Evidence: [career schemas](../../../packages/schema/src/career.ts), [web Apply](../../../apps/web/src/features/career/workspace/apply.tsx), [mobile Apply](../../../apps/mobile/src/features/workspace/tabs/apply.tsx).

This is the clearest native addition with value independent of browser automation.

### Browser and hosted applications

HireSweep offers two execution environments:

| Environment    | Documented behavior                                                                                                        | Important limits                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| User's browser | Extension opens the form, reads fields, uploads documents, fills pages, asks unresolved questions, and supports submission | Desktop Chrome; site permissions; signed-in sessions; site-specific behavior |
| Hosted browser | Background form filling and submission, with progress, questions, screenshots, and run details                             | Account-gated forms and captchas can require handing control back to user    |

Review is the default submit mode. Hybrid and Automatic can send without final review. Recurring searches can also start applications, subject to a service-wide enable switch, score thresholds, daily limits, deduplication, and supported boards. Crucial limit: the guide explicitly says automatically started applications send the resume as it is; they do not generate a tailored copy for each job. Sources: [assisted apply](https://hiresweep.com/features/assisted-apply), [application guide](https://docs.hiresweep.com/guides/applying-to-jobs), [extension guide](https://docs.hiresweep.com/guides/installing-the-browser-extension).

The Chrome Web Store listing independently confirms a published extension, describing LinkedIn reading and form filling. It displayed **4 users and no ratings** when fetched. That is an extension adoption signal only; it does not measure website customers, revenue, or unpacked-extension installs. Source: [store listing](https://chromewebstore.google.com/detail/eedckokmfkjihmnpiepnpocgiofjjhch).

Some operational metadata is inconsistent: the public extension endpoint reported store version 3.4.0 and bundled version 3.9.0, while the actual store listing reported 3.9.0, updated October 28. This establishes version-metadata drift, not a demonstrated failure. Sources: [version endpoint](https://hiresweep.com/api/extension/version), [store](https://chromewebstore.google.com/detail/eedckokmfkjihmnpiepnpocgiofjjhch).

Reactive Resume's Apply workflow prepares and records answers; users submit on the employer's site. Its similarly named MCP `autofill_application_from_job` populates the internal application record from a posting. It is not employer-form autofill. No equivalent browser extension or hosted application execution was found in inspected source.

### Clients, approvals, and reports

HireSweep's operator workflow includes separate client resumes, profiles, applications, and searches; ranking a job across the roster; approval links without client accounts; and revocable read-only progress reports. Approvals expire after seven days and cover the documents and answers reviewed. Its docs instruct requesting approval again after changes. Whether every mutation invalidates approval correctly was not tested. Sources: [client guide](https://docs.hiresweep.com/guides/working-with-clients), [recruiter offering](https://hiresweep.com/for-recruiters).

This represents substantial product work, supported by public OpenAPI routes for clients, roster matching, approval requests, public decisions, and report links. Public routes are evidence of contracts, not a security audit. Source: [OpenAPI](https://hiresweep.com/api/openapi/spec.json).

Reactive Resume's inspected resume, application, and career records are user-owned. Multiple resumes do not provide delegated access, client isolation, permissions, approvals, or shared reporting. A full agency module would be a new ownership model, not a small UI addition.

## What is already covered or stronger in Reactive Resume

| Capability                                 | HireSweep evidence                             | Current Reactive Resume baseline                                                           | Decision                                           |
| ------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Resume design, import/export, public links | 16 templates, PDF/Word/JSON, password links    | 18 templates, broader export options, public sharing                                       | Already covered                                    |
| ATS and posting checks                     | Resume score and free text-based checker       | PDF parser/readability checks, posting terms, writing review                               | Already covered; compare quality, not score labels |
| Job tracking and follow-up                 | Application pipeline, notes, queue             | Configurable stages, notes, contacts, insights, interviews, sent versions                  | Already covered                                    |
| Tailoring and letters                      | Job-specific copies, blocked-edit explanations | Assistant edits and job-linked copies; narrower API shortcut                               | Unify and improve evidence presentation            |
| Discovery and alerts                       | Resume targets, board feeds, match triage      | Configurable search, scheduled discovery, dedupe, notifications                            | Improve setup and ranking                          |
| Career memory and interview workflow       | No comparable end-to-end workflow found        | Facts, STARR stories, fit evidence, preparation, voice practice, debrief, messages, offers | Preserve and make easy to discover                 |
| API and MCP                                | Document/search/apply/client contracts         | Extensive document, check, application, and career tools                                   | Extend existing contracts as features ship         |
| Personal application profile               | Structured eligibility and saved answers       | Preferences and per-job answers, without equivalent central library                        | Add                                                |
| Employer-form autofill                     | Extension and hosted browser                   | Not found                                                                                  | Build browser assistance in stages                 |
| Client approvals and reporting             | Documented operator workflows                  | Not found                                                                                  | Validate narrow collaboration first                |

Reactive Resume evidence: [template schema](../../../packages/schema/src/templates.ts), [career schema](../../../packages/schema/src/career.ts), [workspace](../../../apps/web/src/features/career/workspace), [native workspace](../../../apps/mobile/src/features/workspace), [ATS checker](../../../apps/web/src/features/ats-checker), [MCP](../../../packages/mcp/src), [career implementation guide](../../../docs/contributing/career-platform.mdx).

## Wider competitor check

HireSweep's own comparison pages are useful for learning its positioning, but were not treated as independent descriptions of competitors.

| Product  | Primary-source evidence                                                                                                                             | Implication for Reactive Resume                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Simplify | Free core autofill, job tracking, and matches; paid AI assistance; separate Autopilot submits without review                                        | Autofill is established competition, not HireSweep's unique invention. Differentiation needs control, portability, and integrated evidence |
| Huntr    | Free Basic includes application autofill; paid advanced AI. Application Packets bundle a tailored resume, letter, and follow-up, with bulk creation | A coherent prepare-and-review flow can improve existing Reactive Resume features without autonomous submission                             |
| Teal     | Free job capture extension and tracking; job-linked guidance, contacts, checklists, and follow-up                                                   | Capture and workflow continuity matter independently of hosted form execution                                                              |
| LoopCV   | Searches, applications, and outreach on behalf of clients; shared dashboard and agency offerings                                                    | Client application operations form an established category, but serving it changes product scope                                           |

Sources: [Simplify Copilot](https://simplify.jobs/copilot), [Simplify setup](https://help.simplify.jobs/help/articles/1749022-install-and-set-up-copilot), [Simplify Autopilot](https://help.simplify.jobs/en/help/articles/1784339-get-started-with-autopilot), [Huntr plans](https://help.huntr.co/en/articles/9806024-faq), [Huntr packets](https://help.huntr.co/en/articles/14367332-application-hub-and-packets), [Teal tracker](https://www.tealhq.com/tools/job-tracker), [LoopCV recruiter offering](https://www.loopcv.pro/recruiter/).

These sources establish offered workflows, not comparative success rates. Do not repeat vendor interview-rate, ATS-passing, or time-saving claims without measurement.

## Native product priorities

Effort labels below are relative engineering scope, not delivery estimates. Every native feature requires web/mobile parity and backward-compatible APIs under repository policy.

| Priority | Work                                      | Value                                                              | Relative scope                                                     | Recommendation                     |
| -------- | ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| First    | Application profile and reusable answers  | Reduces repeated work across nearly every application              | Medium                                                             | Build                              |
| First    | Consistent tailoring and preparation      | Makes existing capabilities predictable across UI/API/MCP          | Small to medium for orchestration; larger for evidence enforcement | Build incrementally                |
| Next     | Posting capture and assisted filling      | Removes copying and repeated form entry                            | Medium for capture; large and continuing for filling               | Prototype with narrow site support |
| Next     | Better discovery setup and triage         | Makes existing schedules easier to use and results easier to judge | Medium                                                             | Improve current system             |
| Validate | Coach review and progress sharing         | Supports helpers, nonprofits, universities, and career coaches     | Medium for scoped review; large for operator workspaces            | Validate before broad build        |
| Defer    | Hosted background application submission  | Saves attention but adds external execution and support burden     | Very large and continuing                                          | Keep outside initial native scope  |
| Defer    | Funded hosted AI and credit subscriptions | Removes key setup                                                  | Large operational/business commitment                              | Separate sustainability decision   |

### 1. Application profile and answer library

Keep application-only information separate from public resume data. Reuse existing preferences for availability and salary where meanings match. Add reviewed answers with a source, last-reviewed time, scope, and optional employer/application restrictions. Company-specific answers must not silently become universal answers.

Start with explicit “Save for other applications” and “Use a saved answer” controls in Apply, on web and mobile. Reuse facts as evidence; do not automatically treat a drafted answer as a confirmed fact. Preserve submitted snapshots. Make copy, export, correction, and deletion available without AI. Work-authorization answers need country context and explicit confirmation. Sensitive optional responses should remain optional and outside AI prompts.

Likely owners: `packages/schema`, `packages/db`, an application-domain API feature, web/mobile Apply. Extend existing API/MCP access rather than creating a separate automation store.

### 2. Consistent tailoring and preparation

Make job → selected base resume → tailored proposal → reviewed documents/answers → submission record a clear path. Reuse document assistant proposals, current job links, letters, and sent snapshots. Do not build another independent editor or generation system.

For API/MCP, preserve existing summary-only behavior until an additive reviewable operation is available; silently broadening the old action would change its mutation scope. Expose proposal generation and acceptance separately if a full-document API is introduced. Explain missing evidence and proposed claim changes instead of presenting a score increase as proof.

### 3. Browser assistance

First release: capture a posting's URL, text, company, and role into the existing tracker after review. Mobile needs an equivalent share/import path. A desktop-only extension is not complete parity.

Second release: a user-triggered helper that fills known fields, selects the intended resume and letter, and leaves final submission to the user. Begin with a small explicit support matrix, such as Greenhouse, Lever, and Ashby, based on prototype results. Fall back to copyable answers for unsupported forms. Keep field mappings, document versions, unresolved questions, and failures visible.

New extension scope should remain separate from the builder and PDF engine. Shared contracts and data belong in workspace packages. Support self-hosted origins deliberately. Mobile browser integration has different platform requirements; it needs its own implementation decision and potentially a native build, not an assumed JavaScript-only rollout.

### 4. Discovery improvements

Offer editable role suggestions from resume/Knowledge, show where results came from, and explain matching preferences and missing information. Keep scores and matching signals distinct. Improve triage and freshness in the existing Today/schedule flow.

Only add direct ATS feeds after a measured retrieval study shows a specific coverage or freshness deficit. Direct feeds still require company discovery, adapter maintenance, deduplication, and normalization. HireSweep's board count alone does not prove better results.

### 5. Coach collaboration

Test owner-controlled, revocable resume feedback and selected progress sharing before multi-client operator accounts. Explore whether helpers need read-only review, comments, edits, or true delegated application management; those are different permissions.

If demand supports workspaces, model membership, actor versus owner, scoped permissions, audit history, exports/deletion, and approval of exact versions first. Reusing someone else's login is not a collaboration model. Authorization checks must remain in the owning API services and apply equally to web, mobile, API, and MCP.

## Why defer unattended applications

Hosted application execution adds persistent browser infrastructure, page-specific maintenance, account/session handling, document uploads, captchas, ambiguous completion states, and recovery from failed or duplicated attempts. These costs continue after initial implementation and complicate Reactive Resume's lightweight self-hosting/deployment options.

HireSweep's own guides demonstrate these limits: browser handoffs, hosted versus local restrictions, question timeouts, a global auto-start switch, duplicate suppression, and automatic runs without per-job tailoring. These are useful lessons, not proof its service is unreliable.

Browser assistance captures much of the repetitive-work benefit with a smaller operational commitment. If later measured demand justifies unattended execution, define an optional external executor behind stable contracts, with explicit per-application authority and reliable confirmation, rather than coupling a hosted browser to the core server.

## Validation before expanding scope

Use synthetic histories and controlled forms before any real applications. No live employer submissions are needed for initial evaluation.

- Profile/library: measure time to complete repeated forms and how often reused answers need correction, including stale availability and company-specific wording.
- Tailoring: compare usefulness, unsupported claims, changed numbers/dates, review effort, and consistency across web/mobile/API with several professions and languages.
- Browser helper: measure field correctness, intended-document attachment, unsupported controls, and confirmed versus unknown completion states on controlled ATS-like forms.
- Discovery: compare valid open postings, duplicates, freshness, preference relevance, and provider cost across the same queries and regions.
- Collaboration: observe a small opt-in group of actual coaches/helpers to distinguish document feedback demand from agency operations demand.

Set release thresholds after collecting baseline results. Do not substitute vendor feature lists or higher match scores for user outcomes. Use voluntary research or opt-in local measurement consistent with Reactive Resume's privacy positioning.

## Attribution, maturity, and strategic interpretation

HireSweep explicitly states that portions derive from Reactive Resume and reproduces its MIT notice. It identifies itself as proprietary software operated by ManuSoft Inc. This research establishes attribution is present; it makes no finding about complete license compliance or exact fork ancestry. Source: [license page](https://docs.hiresweep.com/legal/license).

Its changelog describes launch in October 2026 and a subsequent move to one credit balance in the same month. Together with the small public extension count and version/documentation discrepancies, this supports treating it as an early product with a broad documented scope. It does not establish the absence of customers or commercial potential. Sources: [changelog](https://docs.hiresweep.com/changelog), [store listing](https://chromewebstore.google.com/detail/eedckokmfkjihmnpiepnpocgiofjjhch).

The practical competitive lesson is workflow completion. Reactive Resume already has many of the underlying capabilities and a richer documented candidate-preparation system than this review found in HireSweep. The best native additions connect those capabilities to the repetitive work outside the editor: capture the posting, reuse reviewed answers, prepare the right documents, and help fill the form. Agency operations and unattended submission should earn their place through demand and operating economics.
