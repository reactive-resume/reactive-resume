# Glossary

What the recurring terms in Reactive Resume's interface actually mean.

This file exists because most of the interface is translated from short, standalone strings.
A translator, human or machine, sees `Board` or `Resume` with no surrounding sentence, picks the
most common English sense, and gets it wrong. Every entry below has been mistranslated that way
in at least one shipped locale.

**If you are translating, read the term here before translating it.** When the English word has
a common sense that is *not* the one used here, that wrong sense is listed explicitly.

Terms are grouped by the part of the product they belong to. Source references point at where the
string is defined, so you can read the surrounding code when this file is not enough.

## Always left untranslated

Product and technology names stay in English (or in the locale's established transliteration, if
the catalog already uses one consistently):

Reactive Resume, GitHub, Crowdin, Docker, PostgreSQL, Better Auth, TanStack, Microsoft Word,
PDF, DOCX, JSON, CSV, API, MCP, oRPC, SSO, CSS, URL, JSON Resume.

AI provider names are brand names and stay in English: OpenAI, Anthropic Claude, Google
Gemini, Vercel AI Gateway, OpenRouter, Mistral AI, Cohere, xAI Grok, Groq, DeepSeek, Together.ai,
Fireworks, Cerebras, Perplexity, Ollama Cloud.

Template names are proper nouns and are never translated: Azurill, Bronzor, Chikorita, Ditgar,
Ditto, Gengar, Glalie, Kakuna, Lapras, Leafish, Meowth, Onyx, Pikachu, Rhyhorn, Scizor.

## The document

**Resume** — the job-application document the app builds. Always a noun.
Not the verb "to resume", "to continue", or "to restart". This is the single most common
mistranslation in the catalogs: many locales render the standalone `Resume` label as the verb.
In `application-form-sheet.tsx` the label marks the resume attached to a job application.
Where a locale's normal word for this document is CV, use CV.

**Resumes** — plural of the above. A list of the user's documents.

**Cover letter** — the letter accompanying a resume. Stored as a resume section, not a separate
document.

**Builder** — the editor where a resume is composed. A tool, not a construction worker or a
person who builds.

**Template** — a visual design for a resume. Not a "model" in the machine-learning sense, and
not a "sample" or "example" document. Beware in languages where the natural word for template
is also the word for model: the app uses "model" separately, for AI models.

**Section** — one block of a resume, such as Experience or Education. Not a legal section or a
document chapter.

**Item** — one entry inside a section, for example a single job or a single degree. Generic on
purpose. Not "product", "article", or "column".

**Page** — one physical page of the rendered resume. Not a web page.

**Columns** — the column count of a resume layout. Not database or spreadsheet columns.

**Slug** — the URL-safe identifier in a resume's public address. Usually kept in English or
transliterated; never translated as "snail".

### Resume section names

These are the built-in section presets, defined in `apps/web/src/libs/resume/section.tsx` and
`apps/web/src/dialogs/resume/sections/custom.tsx`. Translate them the way a resume in the target
language would label them:

**Basics** — name, contact details, and headline. Not "fundamentals" or "basic settings".

**Summary** — the short personal statement at the top of a resume. Not a summary of the app, and
not an AI-generated abstract.

**Profiles** — links to the user's social and professional accounts (LinkedIn, GitHub). Plural.
Distinct from **Profile**, below, which is the user's own account page. These two are different
things and several catalogs have collapsed them into one word.

**Volunteer** — volunteering experience. A noun naming a section, not the verb "to volunteer".

Also: Experience, Education, Skills, Languages, Awards, Certifications, Interests, Projects,
Publications, References, Custom.

## The application tracker

**Applications** — job applications the user has submitted. Not software applications, apps, or
programs. Frequently mistranslated as the software sense.

**Board** — the kanban board view of applications, arranged in columns by stage. Not a board of
directors, a committee, a plank, or a noticeboard.

**Stage** — where an application sits in the pipeline (applied, interviewing, offer, rejected).
Not a theatre stage or a phase of construction.

**Source** — where the user found the job listing (a job board, a referral, a company site).
Singular, and specific to one application. Not a source code file and not a data source.

**Pipeline** — the sequence of stages an application moves through. A recruiting funnel, not a
physical pipe, duct, conduit, or oil pipeline. Seven locales translated it as plumbing.

**Table** — the table view of applications, one of the view options next to Board and List. Not a
piece of furniture.

**Archive** — a verb in this context: to move an application out of the active list. Not the
noun "an archive". It is a menu action and pairs with **Unarchive**; almost every locale had the
noun here.

**Applied on** — the date the user submitted the application. "Applied" is the job-application
verb, not "applied a substance onto a surface" and not "applied a patch".

**Mark rejected / Mark as…** — "Mark" is the verb, to set a status. It is not the given name Mark.

**Match score** — how well a resume matches a job description. A degree of correspondence, not a
sporting fixture.

**Fit**, as in "Score my fit" or "Strong fit" — how well the user suits the role. Not physical
fitness, and not how clothing fits.

**A stretch** — a role the user is unlikely to get, an ambitious application. Not a stretching
exercise.

**Notes** — the user's free-text notes on an application. Compare **Note** in the ATS checker,
which is not the same thing.

**Timeline** — the dated history of one application.

## The AI agent

**Threads** — conversations with the AI agent. The chat sense, as in a message thread. Not
sewing thread, not string, not yarn, and not a CPU thread. Several locales use the textile word.

**Provider** — a third-party AI service the user configures, such as OpenAI or Anthropic. A
service supplier. Not a healthcare provider, and not a person who provides for a family.

**Model** — the specific AI model chosen from a provider, such as Claude Sonnet or GPT. Not a
**Template** (several locales used the same word for both), not a device model or product
variant, and not a "style" or "pattern".

**Working resume** — the resume a thread is currently editing. "Working" describes the draft
being worked on, not the user's employment. It is not their work history, not a "job resume",
and not a *functional résumé*, which is a real and different résumé format.

**Tailor** — a verb: to adapt a resume to a specific job description. Nothing to do with
dressmaking or sewing.

**Sources** — the citations the agent attaches to an answer. Plural, and distinct from **Source**
in the application tracker above.

**Draft** — a working copy of a resume the agent edits. A noun.

**Patch** — a set of JSON Patch operations the agent proposes. Kept in English in most catalogs.
Not a cloth patch, a scrap of fabric, an adhesive bandage, or a connector.

## The ATS checker

**ATS** — applicant tracking system: recruiting software that parses resumes. Spell it out on
first use in languages where the acronym is unfamiliar. It is not a drug test, a transmission,
or any other expansion of the letters; at least one catalog translated `ATS Check` as a test for
amphetamines.

**Readability, Layout, Sections, Contact details, Dates, Writing** — the six check categories, in
`apps/web/src/features/ats-checker/messages.ts`. "Layout" here means page geometry and reading
order, not the builder's layout settings.

**Blocker, Warning, Tip** — the three severity levels of a finding.

**Note** — the label for an informational finding, in
`apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/ats-check.tsx`. A severity label,
not a written note. Unrelated to **Notes** in the application tracker.

**Parse / parsing** — software reading text out of the PDF.

## Account and security

**Passkey / Passkeys** — a WebAuthn credential that replaces a password, stored on the user's
device or security key. **It is not a password.** Many catalogs translate it with their word for
"password", which is actively confusing: both appear together on the security settings page, so
the user cannot tell which credential a message refers to. If the target language has no
established term, keep "passkey" in English rather than reusing the word for password.

**Password** — the ordinary secret. Distinct from the above, always.

**Two-factor authentication (2FA)** — a second verification step at sign-in.

**Backup codes** — single-use codes for signing in when the second factor is unavailable.

**API key** — a token for programmatic access. **Key** on its own, in `ai-section.tsx`, means the
AI provider's API key. Not a physical door key, not a keyboard key, and not the adjective "key"
in the sense of crucial or main.

**Session** — an active sign-in on one device.

**Sign in / Sign out** — the app's chosen verbs. Prefer the locale's equivalent of "sign in"
over "log in" where both exist, and keep whichever the catalog already uses consistently.

## Navigation and app shell

**Dashboard** — the main page after signing in, listing resumes and applications. Not a vehicle
dashboard, an instrument panel, or a control panel in the machinery sense.

**Profile** — the user's own account settings page. Distinct from **Profiles**, the resume
section, above.

**Lock / Unlock** — verbs: to make a resume read-only, and to release it.

**Tags** — user-defined labels for organizing resumes and applications.

**Custom** — in `color-picker.tsx`, a user-chosen color as opposed to a preset. An adjective.

**Public URL** — the shareable address of a published resume. Use one term consistently; the
English strings say "public URL" rather than "public link".

## Verbs that read as adjectives or nouns

Button labels and `aria-label` strings are usually **imperative verbs**: they say what the
control does. Read as a noun or an adjective, they turn into nonsense. This is the most common
error in the catalogs after the ambiguous nouns above.

**Open** — the verb. `Open AI agent` means *open the AI agent panel*; it does not describe an
agent that is "open", and it is **not a reference to OpenAI, the company**. Around forty-five of
the fifty-three catalogs got this wrong, split between "an open AI agent" and a transliteration
of *OpenAI*. The same applies to `Open in builder`.

**Close** — likewise the verb, as in `Close AI assistant`. Not "an assistant for closing things",
and not the adjective "close/nearby".

The app names two different surfaces here, and both strings are real: **AI agent** is the
full workspace at `/agent`, opened from the builder dock (`Open AI agent`), while **AI assistant**
is the panel that slides out inside the builder (`Open AI assistant`, `Close AI assistant`).
Translate them as two distinct names, the way the English does.

**Clear** — the verb, to empty a field or remove filters. Not the adjective "transparent",
"obvious", or "clear-cut".

**Lock / Unlock** — verbs. `Unlock` is specifically the opposite of `Lock`, not a synonym for
`Open`; several catalogs collapsed the two and produced two identical menu items.

**Archive / Unarchive**, **Mark**, **Tailor**, **Duplicate**, **Import**, **Export**, **Share**,
**Star** — all verbs when they appear as a control label. Check the `#:` source reference if you
are unsure whether a given string is a button or a heading.

## Message syntax

These are not words to translate, and breaking them breaks the interface:

- `{name}`, `{count}`, `{email}`, `{MAX_IMPORT}`, `{overflow}` — value placeholders. Keep the
  spelling exactly, keep every one that appears in the source, and add none.
- `{count, plural, one {# item} other {# items}}` — ICU plurals. Translate only the text inside
  the inner braces, keep the `#`, and use the plural categories your language actually needs
  (Arabic and the Slavic languages legitimately have more than English).
- `<0>…</0>`, `<1>…</1>`, `<0/>` — indexes pointing at interface elements such as links and bold
  spans. Keep every index and keep the pairs matched. You may move a tag inside the sentence for
  word order, as long as it still wraps the corresponding words.

A missing or renamed placeholder is a runtime error, not a style problem.

## Adding to this file

When a translator asks what a term means, the answer belongs here. When you add a term, say what
it means in this app and, if the English word is ambiguous, say plainly which sense is wrong.
