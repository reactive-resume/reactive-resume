---
name: resume-builder
description: Builds a complete resume from scratch as Reactive Resume JSON that conforms to the schema and imports at https://rxresu.me. Asks for each missing detail instead of inventing it, then produces valid JSON (UUIDs, HTML descriptions, template and layout). Use when the user wants to create, build or generate a new resume, turn their work history into Reactive Resume JSON, or asks about the Reactive Resume schema, sections, templates or layout. For what belongs on a resume or a resume audit use resume-content-guide; for rewriting bullets, resume-bullet-writer; for fitting one job posting, resume-tailor; for tracking applications, job-application-manager; for interviews, interview-prep or mock-interview.
---

# Resume Builder for Reactive Resume

Build professional resumes through conversational AI for [Reactive Resume](https://rxresu.me), a free and open-source resume builder.

## Core Principles

1. **Never invent** - Only include information the user provided. Ask for missing facts; accept honest ranges and label them as estimates ("about 30%"). If asked to fabricate, decline in one sentence and offer the honest alternative in the same reply
2. **Ask questions** - When information is missing or unclear, ask before assuming
3. **Be concise** - Use clear, direct language; avoid filler words
4. **Validate output** - Ensure all generated JSON conforms to the schema

## Related skills

This skill builds the document. Sibling skills do the rest; they may not be installed, and when one is missing, do the light version yourself and say so.

- **resume-content-guide:** what goes on the resume and what stays off (photo, date of birth, GPA, gaps, summaries), country and industry norms, length, and audits of an existing resume.
- **resume-bullet-writer:** digs out achievements role by role and turns duties into impact bullets.
- **resume-tailor:** fits a resume to one job posting (requirement table, gap questions, tailored copy, optional cover letter).
- **job-application-manager:** the job-search pipeline: intake, stages, follow-ups, the resume version sent, weekly reviews and messages.
- **interview-prep:** story bank, company brief, likely questions and the post-interview debrief.
- **mock-interview:** role-played practice interviews for a specific job description, with rubric scores.
- **offer-negotiation:** evaluates and negotiates job offers: decodes the terms, benchmarks pay, drafts the counter, role-plays the recruiter and writes the acceptance or decline.

## Workflow

### Step 1: Gather Basic Information

Ask for essential details first, unless the user has already provided them:

- Full name
- Professional headline/title
- Email address
- Phone number
- Location (city, state/country)
- Website (optional)

### Step 2: Collect Section Content

For each section the user wants to include, gather specific details. Never invent dates, company names, or achievements.

**Experience**: company, position, location, period (e.g., "Jan 2020 - Present"), description of responsibilities/achievements

**Education**: school, degree, area of study, grade (optional), location, period

**Skills**: name, proficiency level (Beginner/Intermediate/Advanced/Expert), keywords

**Projects**: name, period, website (optional), description

**Other sections**: languages, certifications, awards, publications, volunteer work, interests, references

### Step 3: Configure Layout and Design

Ask about preferences:

- Template preference (18 available: azurill, bronzor, chikorita, ditto, ditgar, gengar, glalie, kakuna, lapras, leafish, meowth, onyx, persian, pikachu, porygon, rhyhorn, scizor, smeargle)
- Page format: A4 or Letter
- Which sections to include and their order

### Step 4: Generate Valid JSON

Output must conform to the Reactive Resume schema. See [references/schema.md](references/schema.md) for the complete schema structure.

Key requirements:

- All item `id` fields must be valid UUIDs
- Description fields accept HTML-formatted strings (bullets as `<ul><li><p>…</p></li></ul>`, never Markdown)
- Write structured `dates` (`{ "start": "2020-01", "end": null, "present": true }`); the legacy `period` and `date` text is rewritten from them on save
- Website fields require both `url` and `label` properties
- Colors use `rgba(r, g, b, a)` format
- Fonts must be available on Google Fonts

## Content Essentials

For deeper content work, hand off to resume-content-guide (what to include, country norms, audits) and resume-bullet-writer (achievement bullets). If neither is installed, apply these core rules:

- **Achievements, not duties**: start each bullet with a plain past-tense verb and say what changed. Use only numbers the user gives you, or honest ranges marked as estimates; never invent one. No "I", "my" or "we".
- **Bullets per role**: 3–6 for recent roles, 1–3 for older ones.
- **Length**: 1 page for students and under ~5 years of experience; 1–2 pages for most experienced candidates; 2–3 for senior or executive roles. US federal (USAJOBS) resumes are 2 pages maximum as of 2026.
- **Order**: experienced candidates: a 2–4 line summary, then Experience, Education, Skills, then Projects or Certifications if relevant. Students and new graduates: Education first, then Projects or Experience (whichever is stronger), then Skills; skip the summary when the page is full or it only repeats the headline.
- **Personal data**: in the US, UK, Canada and Australia, leave out the photo (`picture.hidden: true`), date of birth, marital status, full street address and ID numbers. Other countries differ.
- **Skills**: grouped hard skills the user can back up in a bullet; set `level` to 0 to hide proficiency dots.
- **Format**: consistent month/year dates; prefer a one-column template for applications through job portals.

## Output Format

When generating the resume, output a complete JSON object that conforms to the Reactive Resume schema. The user can then import this JSON directly into Reactive Resume at https://rxresu.me. With the Reactive Resume MCP server connected, offer to create it with `import_resume {data}` instead, after the user approves; if the payload is too large for the client, give the JSON file.

Example minimal structure:

```json
{
  "picture": { "hidden": true, "url": "", "size": 80, "rotation": 0, "aspectRatio": 1, "borderRadius": 0, "borderColor": "rgba(0, 0, 0, 0.5)", "borderWidth": 0, "shadowColor": "rgba(0, 0, 0, 0.5)", "shadowWidth": 0 },
  "basics": { "name": "", "headline": "", "email": "", "phone": "", "location": "", "website": { "url": "", "label": "" }, "customFields": [] },
  "summary": { "title": "Summary", "columns": 1, "hidden": false, "content": "" },
  "sections": { ... },
  "customSections": [],
  "metadata": { "template": "onyx", "layout": { ... }, ... }
}
```

For the complete schema, see [references/schema.md](references/schema.md).

## MCP Application Tracking

The Reactive Resume MCP server also manages job applications. For pipeline work (adding jobs, moving stages, follow-ups, recording the resume version sent, weekly reviews, messages), use the job-application-manager skill. If it isn't installed:

- `list_applications` before changing existing records; `create_application` for a new opportunity.
- `update_application` to move a stage or link a resume; `add_application_note` to log activity.
- AI tools (`score_application_match`, `tailor_resume_for_application`, `draft_application_message`) send the resume and posting to the user's AI provider: ask first, and review their output before the user sends anything.

## Asking Good Questions

When information is missing, ask specific questions:

- "What was your job title at [Company]?"
- "What dates did you work there? (e.g., Jan 2020 - Dec 2022)"
- "What were your main responsibilities or achievements in this role?"
- "Do you have a specific target role or industry in mind?"

Avoid compound questions. Ask one thing at a time for clarity.
