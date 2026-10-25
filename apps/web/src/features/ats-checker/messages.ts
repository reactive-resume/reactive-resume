import type { PdfCategory, PdfRuleCode, PdfSeverity } from "@reactive-resume/resume/ats-pdf";
import { t } from "@lingui/core/macro";
import { match } from "ts-pattern";

export type PdfFindingMessage = {
	title: string;
	action: string;
};

/**
 * Every rule code the engine can report, in the reader's language.
 *
 * Flat and exhaustive on purpose. `.exhaustive()` over the engine's own code union makes a new
 * rule a compile error that names the missing code, so a raw code can never reach the UI, and
 * one arm per code means adding a rule is one edit here, not three.
 *
 * House style: say what is true about the file, then what to do about it. Never claim a file will
 * be rejected. No tool knows that.
 */
export function getPdfFindingMessage(code: PdfRuleCode): PdfFindingMessage {
	return (
		match(code)
			// ---- Parseability: nothing readable came out ----
			.with("NO_TEXT_LAYER", () => ({
				title: t`No text could be read from this file.`,
				action: t`Export the resume as a text PDF rather than as an image or a scan.`,
			}))
			.with("IMAGE_ONLY_DOCUMENT", () => ({
				title: t`The pages are pictures, with no text behind them.`,
				action: t`Export from the original document instead of scanning or screenshotting it.`,
			}))
			.with("GARBLED_TEXT", () => ({
				title: t`The text comes out unreadable.`,
				action: t`Re-export with fonts embedded, then open the file and check that the text copies out cleanly.`,
			}))
			.with("TYPE3_FONT", () => ({
				title: t`This file uses Type 3 fonts, which carry drawings instead of characters.`,
				action: t`Re-export using an ordinary TrueType or OpenType font.`,
			}))
			.with("INVALID_EMBEDDED_FONT", () => ({
				title: t`An embedded font could not be read.`,
				action: t`Re-export from the original document with fonts embedded properly.`,
			}))
			// ---- Parseability: the file is the wrong kind of thing ----
			.with("FILE_TOO_LARGE", () => ({
				title: t`This file is larger than many application forms accept.`,
				action: t`Keep it under 2.5 MB, usually by removing or shrinking images.`,
			}))
			.with("ENCRYPTED_PDF", () => ({
				title: t`This file is encrypted.`,
				action: t`Save an unprotected copy, with no password and no permissions restrictions.`,
			}))
			.with("XFA_FORM", () => ({
				title: t`This is an XFA form, so most software reads only the empty shell.`,
				action: t`Print or export the form to a flat PDF before sending it.`,
			}))
			.with("PDF_PORTFOLIO", () => ({
				title: t`This is a PDF Portfolio: the visible page is only a cover.`,
				action: t`Send the resume itself rather than a portfolio wrapper.`,
			}))
			.with("ACROFORM_FIELDS", () => ({
				title: t`This file contains form fields.`,
				action: t`Flatten the form so the text is part of the page.`,
			}))
			// ---- Parseability: the characters came out wrong ----
			.with("REPLACEMENT_CHARACTERS", () => ({
				title: t`Some characters come out as question marks.`,
				action: t`Re-export with fonts embedded, and check the text copies out cleanly.`,
			}))
			.with("PRIVATE_USE_CHARACTERS", () => ({
				title: t`Some glyphs have no meaning outside this file.`,
				action: t`Replace icon fonts with plain text, then re-export.`,
			}))
			.with("LIGATURE_CHARACTERS", () => ({
				title: t`Ligatures can drop letters out of words such as "workflow".`,
				action: t`Turn off discretionary ligatures when exporting.`,
			}))
			.with("NON_EMBEDDED_FONTS", () => ({
				title: t`A font is referenced but not embedded.`,
				action: t`Embed all fonts when exporting, so characters map the way you intended.`,
			}))
			.with("LOST_WORD_SPACING", () => ({
				title: t`Words run together when the text is extracted.`,
				action: t`Re-export from the original document rather than converting from another format.`,
			}))
			.with("SPLIT_CHARACTER_SPACING", () => ({
				title: t`Text is written one character at a time.`,
				action: t`Avoid heavy letter-spacing effects, then re-export.`,
			}))
			// ---- Parseability: what the document declares about itself ----
			.with("INVISIBLE_TEXT", () => ({
				title: t`This file contains text drawn invisibly.`,
				action: t`If it came from a scan, that is expected. Otherwise remove it; recruiters read it as keyword stuffing.`,
			}))
			.with("WHITE_TEXT", () => ({
				title: t`This file contains white-on-white text.`,
				action: t`Delete it. Hidden keywords are treated as a deliberate attempt to game the search.`,
			}))
			.with("LOW_TEXT_DENSITY", () => ({
				title: t`Very little text was recovered for this many pages.`,
				action: t`Open the exported file and confirm you can select and copy every part of it.`,
			}))
			.with("HIGH_IMAGE_COVERAGE", () => ({
				title: t`Images cover most of the page.`,
				action: t`Keep resume content as real text rather than as pictures of text.`,
			}))
			.with("VERTICAL_TEXT", () => ({
				title: t`Some text is rotated.`,
				action: t`Lay the text out horizontally. Rotated runs are often dropped or misplaced.`,
			}))
			.with("ROTATED_PAGES", () => ({
				title: t`A page is rotated.`,
				action: t`Save the file with every page upright.`,
			}))
			.with("NON_STANDARD_PAGE_SIZE", () => ({
				title: t`This is not a common resume page size.`,
				action: t`Use A4 or US Letter so the layout survives being re-rendered.`,
			}))
			.with("UNTAGGED_PDF", () => ({
				title: t`This file has no accessibility tags.`,
				action: t`Tags give software an explicit reading order. Enable them when exporting, if your tool offers it.`,
			}))
			.with("MISSING_DOCUMENT_LANGUAGE", () => ({
				title: t`This file declares no language.`,
				action: t`Set the document language when exporting.`,
			}))
			.with("LARGE_FILE_SIZE", () => ({
				title: t`This file is large for a resume.`,
				action: t`Compress or remove large images to keep uploads quick.`,
			}))
			.with("TRUNCATED_ANALYSIS", () => ({
				title: t`Only the first pages were checked.`,
				action: t`Nothing to fix. The remaining pages were simply not covered by this report.`,
			}))
			// ---- Layout ----
			.with("MULTI_COLUMN_LAYOUT", () => ({
				title: t`This page is in columns, and the text extracts out of order.`,
				action: t`Use a single column for anything that has to be read in sequence.`,
			}))
			.with("READING_ORDER_INVERSION", () => ({
				title: t`The order the text is stored in disagrees badly with the order it reads in.`,
				action: t`Re-export from a single-column layout, then copy the text out and check it reads top to bottom.`,
			}))
			.with("READING_ORDER_RISK", () => ({
				title: t`Some lines are stored out of reading order.`,
				action: t`Copy the text out of the exported file and read it through; fix anything that arrives in the wrong place.`,
			}))
			.with("COLUMN_GUTTER", () => ({
				title: t`A full-height gap splits this page into two columns.`,
				action: t`Prefer a single column, or keep the side column to short, self-contained lists.`,
			}))
			.with("TABLE_LIKE_LAYOUT", () => ({
				title: t`Content is laid out in a grid.`,
				action: t`Replace tables with plain paragraphs and lists. Cells extract in storage order, not reading order.`,
			}))
			.with("TEXT_IN_MARGIN_ZONE", () => ({
				title: t`Text sits in the header or footer area.`,
				action: t`Move real content into the body of the page; some software discards the margins.`,
			}))
			.with("TIGHT_LINE_SPACING", () => ({
				title: t`Your lines are packed very tightly.`,
				action: t`Increase line spacing so two lines are not merged into one.`,
			}))
			.with("SMALL_BODY_TEXT", () => ({
				title: t`Your body text is very small.`,
				action: t`Use at least 9pt.`,
			}))
			.with("MANY_DISTINCT_FONTS", () => ({
				title: t`This file uses a lot of different fonts.`,
				action: t`Keep to two or three families. Each extra font is another chance for one to map badly.`,
			}))
			.with("NARROW_PAGE_MARGINS", () => ({
				title: t`Your margins are very narrow.`,
				action: t`Leave at least half an inch around the page.`,
			}))
			.with("TEXT_OUTSIDE_PAGE", () => ({
				title: t`Some text falls outside the page.`,
				action: t`Move all content inside the page boundaries and re-export.`,
			}))
			.with("NON_STANDARD_BULLET_GLYPHS", () => ({
				title: t`Your bullets are drawn with unusual characters.`,
				action: t`Use your editor's normal bullet list, so stray glyphs do not land mid-sentence.`,
			}))
			.with("DENSE_PAGE", () => ({
				title: t`This page is very densely packed.`,
				action: t`Add some whitespace between sections so a person can skim it.`,
			}))
			.with("REPEATED_HEADER_FOOTER", () => ({
				title: t`The same line repeats on every page.`,
				action: t`Keep running heads short, or drop them. They repeat in the extracted text too.`,
			}))
			// ---- Sections ----
			.with("NO_EXPERIENCE_SECTION", () => ({
				title: t`No work-experience section was found.`,
				action: t`Add a section headed "Experience" or "Work Experience". It is the field most systems rank on.`,
			}))
			.with("NO_RECOGNIZED_HEADINGS", () => ({
				title: t`No conventional section headings were found.`,
				action: t`Use plain headings such as "Experience", "Education" and "Skills".`,
			}))
			.with("FEW_SECTION_HEADINGS", () => ({
				title: t`Only one recognizable section heading was found.`,
				action: t`Break the resume into the usual sections so it can be segmented.`,
			}))
			.with("NO_EDUCATION_SECTION", () => ({
				title: t`No education section was found.`,
				action: t`Add a section headed "Education". Many systems have a required education field.`,
			}))
			.with("NO_SKILLS_SECTION", () => ({
				title: t`No skills section was found.`,
				action: t`List the tools and technologies you use. Recruiters search skills more than any other field.`,
			}))
			.with("HEADINGS_NOT_DISTINGUISHED", () => ({
				title: t`Your headings look the same as your body text.`,
				action: t`Make them visibly larger, bolder or capitalized.`,
			}))
			.with("VERY_SHORT_DOCUMENT", () => ({
				title: t`Very few words were recovered for a resume.`,
				action: t`Check the exported file contains everything you expect, and that all of it is selectable text.`,
			}))
			.with("NO_BULLET_POINTS", () => ({
				title: t`No bullet lists were found.`,
				action: t`Describe each role with short bullets. Solid paragraphs are harder to skim and to segment.`,
			}))
			.with("NO_ROLE_LINES", () => ({
				title: t`No lines look like a job title paired with an employer.`,
				action: t`Write each role as a clear title and company line, with the dates alongside.`,
			}))
			.with("NO_SUMMARY_SECTION", () => ({
				title: t`There is no summary paragraph.`,
				action: t`Add two or three lines at the top describing what you do.`,
			}))
			// ---- Contact details ----
			.with("NO_EMAIL", () => ({
				title: t`No email address was found.`,
				action: t`Put a plain email address near the top of the first page. It is what most systems file you under.`,
			}))
			.with("NO_PHONE", () => ({
				title: t`No phone number was found.`,
				action: t`Add one with its country code; some application forms require it before you can submit.`,
			}))
			.with("NO_NAME_LINE", () => ({
				title: t`The top of the first page does not look like a name.`,
				action: t`Start the resume with your name on its own line.`,
			}))
			.with("CONTACT_NOT_ON_FIRST_PAGE", () => ({
				title: t`Your contact details are not on the first page.`,
				action: t`Move your email and phone number to the top of page one.`,
			}))
			.with("EMAIL_SPLIT_ACROSS_ITEMS", () => ({
				title: t`Your email address is broken across pieces of text.`,
				action: t`Write it as one uninterrupted piece, with no special spacing.`,
			}))
			.with("LINK_TEXT_URL_MISMATCH", () => ({
				title: t`A link points somewhere other than the address it shows.`,
				action: t`Make the visible text and the destination match.`,
			}))
			.with("MULTIPLE_EMAILS", () => ({
				title: t`More than one email address appears.`,
				action: t`Keep a single address, so software does not have to guess which one to use.`,
			}))
			.with("NO_PROFESSIONAL_LINK", () => ({
				title: t`There is no link to a profile, portfolio or repository.`,
				action: t`Add one link that shows your work.`,
			}))
			.with("BARE_URL_WITHOUT_PROTOCOL", () => ({
				title: t`A web address is written without https://.`,
				action: t`Write the full address so it is recognized as a link.`,
			}))
			.with("PHONE_FORMAT_UNUSUAL", () => ({
				title: t`Your phone number is written in an unusual shape.`,
				action: t`Use a plain international form, such as +1 555 010 1234.`,
			}))
			// ---- Dates ----
			.with("NO_DATES_FOUND", () => ({
				title: t`No dates were found.`,
				action: t`Give every role a period, such as "Jan 2020 - Present", so your timeline can be reconstructed.`,
			}))
			.with("FEW_DATES", () => ({
				title: t`Most entries have no dates.`,
				action: t`Give every role and qualification a date range.`,
			}))
			.with("UNPARSEABLE_DATE_RANGE", () => ({
				title: t`A date range is written in a form most software cannot read.`,
				action: t`Use a recognized form such as "Jan 2020 - Mar 2022" or "2020 - 2022".`,
			}))
			.with("REVERSED_DATE_RANGE", () => ({
				title: t`A date range ends before it starts.`,
				action: t`Swap the start and end dates.`,
			}))
			.with("FUTURE_DATED_ENTRY", () => ({
				title: t`A date is in the future.`,
				action: t`Correct the year, or write "Present" for ongoing work.`,
			}))
			.with("MIXED_DATE_FORMATS", () => ({
				title: t`Your dates are written several different ways.`,
				action: t`Pick one format and use it everywhere.`,
			}))
			.with("NO_CURRENT_ROLE_MARKER", () => ({
				title: t`Nothing marks a role as ongoing.`,
				action: t`Write "Present" as the end date of your current role.`,
			}))
			.with("AMBIGUOUS_NUMERIC_DATE", () => ({
				title: t`A numeric date reads differently in different countries.`,
				action: t`Spell the month, as in "Mar 2022".`,
			}))
			// ---- Content: unscored advice ----
			.with("NO_QUANTIFIED_IMPACT", () => ({
				title: t`Almost none of your bullets carry a number.`,
				action: t`Add figures where you have them: volumes, percentages, timeframes, team sizes.`,
			}))
			.with("WEAK_ACTION_VERBS", () => ({
				title: t`Most bullets open with filler rather than something you did.`,
				action: t`Start each one with a concrete verb: built, led, reduced, migrated.`,
			}))
			.with("FIRST_PERSON_PRONOUNS", () => ({
				title: t`Your resume uses "I" and "my".`,
				action: t`Drop the pronouns and start from the verb. That is the convention in most markets.`,
			}))
			.with("LONG_BULLETS", () => ({
				title: t`Some bullets run long.`,
				action: t`Keep them to roughly two lines, so a skim-reader finishes them.`,
			}))
			.with("HIGH_PAGE_COUNT", () => ({
				title: t`This resume is long.`,
				action: t`Length is not a defect, and there is no universal one-page rule. Keep the pages that earn their place.`,
			}))
			.with("EMPLOYMENT_GAP", () => ({
				title: t`There is a gap between two dated roles.`,
				action: t`A gap is not a problem. Add a one-line explanation if you want to; many strong resumes simply do not.`,
			}))
			.with("ALL_CAPS_RUNS", () => ({
				title: t`Long stretches are set in capitals.`,
				action: t`Reserve capitals for short headings. They slow reading and can defeat case-sensitive search.`,
			}))
			.with("REPEATED_PHRASES", () => ({
				title: t`Many bullets start with the same phrase.`,
				action: t`Vary the openings so the section does not read as boilerplate.`,
			}))
			.exhaustive()
	);
}

export function getPdfCategoryLabel(category: PdfCategory): string {
	return match(category)
		.with("parseability", () => t`Readability`)
		.with("layout", () => t`Layout`)
		.with("sections", () => t`Sections`)
		.with("contact", () => t`Contact details`)
		.with("dates", () => t`Dates`)
		.with("content", () => t`Writing`)
		.exhaustive();
}

export function getPdfCategoryDescription(category: PdfCategory): string {
	return match(category)
		.with("parseability", () => t`Whether software can recover the words at all.`)
		.with("layout", () => t`Whether the page geometry preserves reading order.`)
		.with("sections", () => t`Whether the resume is segmented the way software expects.`)
		.with("contact", () => t`Whether a recruiter can reach you.`)
		.with("dates", () => t`Whether your timeline can be reconstructed.`)
		.with("content", () => t`Advice for the person reading it. None of this affects the score.`)
		.exhaustive();
}

export function getPdfSeverityLabel(severity: PdfSeverity): string {
	return match(severity)
		.with("blocker", () => t`Blocker`)
		.with("warning", () => t`Warning`)
		.with("tip", () => t`Tip`)
		.exhaustive();
}
