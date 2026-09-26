---
name: resume-builder
description: Generate professional resumes that conform to the Reactive Resume schema. Use when the user wants to create, build, or generate a resume through conversational AI, or asks about resume structure, sections, or content. This skill guides the agent to ask clarifying questions, avoid hallucination, and produce valid JSON output for https://rxresu.me.
---

# Resume Builder for Reactive Resume

Build professional resumes through conversational AI for [Reactive Resume](https://rxresu.me), a free and open-source resume builder.

## Core Principles

1. **Never hallucinate** - Only include information explicitly provided by the user
2. **Ask questions** - When information is missing or unclear, ask before assuming
3. **Be concise** - Use clear, direct language; avoid filler words
4. **Validate output** - Ensure all generated JSON conforms to the schema

## Workflow

### MCP Application Tracking

Reactive Resume MCP can manage job applications as well as resumes. When the user wants to track applications through an agent, use the application tools instead of asking them to open the web UI.

- Use `list_applications` before changing existing records.
- Use `create_application` for one new opportunity or `import_applications` for spreadsheet/CSV rows.
- Use `update_application` to move stages, archive/unarchive, edit contacts, set follow-ups, link a resume, or update job details.
- Use `add_application_note` to log timeline activity.
- Use `add_application_interview` / `update_application_interview` to schedule or reschedule interviews (they appear on the timeline and calendar); delete them with `delete_application_timeline_entry`.
- Use `attach_application_document` and `remove_application_document` for sent resume or cover-letter PDFs.
- Use `score_application_match`, `tailor_resume_for_application`, and `draft_application_message` for Application Copilot workflows after a linked resume and job description exist.
- Review AI-generated cover letters and follow-ups before sending them.

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

- Template preference (15 available: azurill, bronzor, chikorita, ditto, ditgar, gengar, glalie, kakuna, lapras, leafish, meowth, onyx, pikachu, rhyhorn, scizor)
- Page format: A4 or Letter
- Which sections to include and their order

### Step 4: Generate Valid JSON

Output must conform to the Reactive Resume schema. See [references/schema.md](references/schema.md) for the complete schema structure.

Key requirements:

- All item `id` fields must be valid UUIDs
- Description fields accept HTML-formatted strings
- Website fields require both `url` and `label` properties
- Colors use `rgba(r, g, b, a)` format
- Fonts must be available on Google Fonts

## Resume Writing Tips

Share these tips when helping users craft their resume content:

### Content Guidelines

- **Lead with impact**: Start bullet points with action verbs (Led, Developed, Increased, Managed)
- **Quantify achievements**: Use numbers when possible ("Increased sales by 25%", "Managed team of 8")
- **Tailor to the role**: Emphasize relevant experience for the target position
- **Be specific**: Replace vague terms with concrete examples
- **Keep it concise**: 1-2 pages maximum for most professionals

### Section Order Recommendations

For most professionals:

1. Summary (if experienced)
2. Experience
3. Education
4. Skills
5. Projects (if relevant)
6. Certifications/Awards

For students/recent graduates:

1. Education
2. Projects
3. Skills
4. Experience (if any)
5. Activities/Volunteer

### Common Mistakes to Avoid

- Including personal pronouns ("I", "my")
- Using passive voice
- Listing job duties instead of achievements
- Including irrelevant personal information
- Inconsistent date formatting

## Output Format

When generating the resume, output a complete JSON object that conforms to the Reactive Resume schema. The user can then import this JSON directly into Reactive Resume at https://rxresu.me.

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

## Asking Good Questions

When information is missing, ask specific questions:

- "What was your job title at [Company]?"
- "What dates did you work there? (e.g., Jan 2020 - Dec 2022)"
- "What were your main responsibilities or achievements in this role?"
- "Do you have a specific target role or industry in mind?"

Avoid compound questions. Ask one thing at a time for clarity.
