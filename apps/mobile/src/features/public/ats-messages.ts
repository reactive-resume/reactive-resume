// Ported from apps/web/src/features/ats-checker/messages.ts (ts-pattern `match` → exhaustive `switch`). Keep the copy
// identical so the catalogs share translations.
import type { PdfCategory, PdfRuleCode } from "@reactive-resume/resume/ats-pdf";
import { t } from "@lingui/core/macro";

export type PdfFindingMessage = {
	title: string;
	action: string;
};

/**
 * Every rule code the engine can report, in the reader's language.
 *
 * Flat and exhaustive on purpose. The `switch` over the engine's own code union makes a new
 * rule a compile error that names the missing code, so a raw code can never reach the UI, and
 * one arm per code means adding a rule is one edit here, not three.
 *
 * House style: say what is true about the file, then what to do about it. Never claim a file will
 * be rejected. No tool knows that.
 */
export function getPdfFindingMessage(code: PdfRuleCode): PdfFindingMessage {
	switch (code) {
		// ---- Parseability: nothing readable came out ----
		case "NO_TEXT_LAYER":
			return {
				title: t`No text could be read from this file.`,
				action: t`Export the resume as a text PDF rather than as an image or a scan.`,
			};
		case "IMAGE_ONLY_DOCUMENT":
			return {
				title: t`The pages are pictures, with no text behind them.`,
				action: t`Export from the original document instead of scanning or screenshotting it.`,
			};
		case "GARBLED_TEXT":
			return {
				title: t`The text comes out unreadable.`,
				action: t`Re-export with fonts embedded, then open the file and check that the text copies out cleanly.`,
			};
		case "TYPE3_FONT":
			return {
				title: t`This file uses Type 3 fonts, which carry drawings instead of characters.`,
				action: t`Re-export using an ordinary TrueType or OpenType font.`,
			};
		case "INVALID_EMBEDDED_FONT":
			return {
				title: t`An embedded font could not be read.`,
				action: t`Re-export from the original document with fonts embedded properly.`,
			};
		// ---- Parseability: the file is the wrong kind of thing ----
		case "FILE_TOO_LARGE":
			return {
				title: t`This file is larger than many application forms accept.`,
				action: t`Keep it under 2.5 MB, usually by removing or shrinking images.`,
			};
		case "ENCRYPTED_PDF":
			return {
				title: t`This file is encrypted.`,
				action: t`Save an unprotected copy, with no password and no permissions restrictions.`,
			};
		case "XFA_FORM":
			return {
				title: t`This is an XFA form, so most software reads only the empty shell.`,
				action: t`Print or export the form to a flat PDF before sending it.`,
			};
		case "PDF_PORTFOLIO":
			return {
				title: t`This is a PDF Portfolio: the visible page is only a cover.`,
				action: t`Send the resume itself rather than a portfolio wrapper.`,
			};
		case "ACROFORM_FIELDS":
			return {
				title: t`This file contains form fields.`,
				action: t`Flatten the form so the text is part of the page.`,
			};
		// ---- Parseability: the characters came out wrong ----
		case "REPLACEMENT_CHARACTERS":
			return {
				title: t`Some characters come out as question marks.`,
				action: t`Re-export with fonts embedded, and check the text copies out cleanly.`,
			};
		case "PRIVATE_USE_CHARACTERS":
			return {
				title: t`Some glyphs have no meaning outside this file.`,
				action: t`Replace icon fonts with plain text, then re-export.`,
			};
		case "LIGATURE_CHARACTERS":
			return {
				title: t`Ligatures can drop letters out of words such as "workflow".`,
				action: t`Turn off discretionary ligatures when exporting.`,
			};
		case "NON_EMBEDDED_FONTS":
			return {
				title: t`A font is referenced but not embedded.`,
				action: t`Embed all fonts when exporting, so characters map the way you intended.`,
			};
		case "LOST_WORD_SPACING":
			return {
				title: t`Words run together when the text is extracted.`,
				action: t`Re-export from the original document rather than converting from another format.`,
			};
		case "SPLIT_CHARACTER_SPACING":
			return {
				title: t`Text is written one character at a time.`,
				action: t`Avoid heavy letter-spacing effects, then re-export.`,
			};
		// ---- Parseability: what the document declares about itself ----
		case "INVISIBLE_TEXT":
			return {
				title: t`This file contains text drawn invisibly.`,
				action: t`If it came from a scan, that is expected. Otherwise remove it; recruiters read it as keyword stuffing.`,
			};
		case "WHITE_TEXT":
			return {
				title: t`This file contains white-on-white text.`,
				action: t`Delete it. Hidden keywords are treated as a deliberate attempt to game the search.`,
			};
		case "LOW_TEXT_DENSITY":
			return {
				title: t`Very little text was recovered for this many pages.`,
				action: t`Open the exported file and confirm you can select and copy every part of it.`,
			};
		case "HIGH_IMAGE_COVERAGE":
			return {
				title: t`Images cover most of the page.`,
				action: t`Keep resume content as real text rather than as pictures of text.`,
			};
		case "VERTICAL_TEXT":
			return {
				title: t`Some text is rotated.`,
				action: t`Lay the text out horizontally. Rotated runs are often dropped or misplaced.`,
			};
		case "ROTATED_PAGES":
			return {
				title: t`A page is rotated.`,
				action: t`Save the file with every page upright.`,
			};
		case "NON_STANDARD_PAGE_SIZE":
			return {
				title: t`This is not a common resume page size.`,
				action: t`Use A4 or US Letter so the layout survives being re-rendered.`,
			};
		case "UNTAGGED_PDF":
			return {
				title: t`This file has no accessibility tags.`,
				action: t`Tags give software an explicit reading order. Enable them when exporting, if your tool offers it.`,
			};
		case "MISSING_DOCUMENT_LANGUAGE":
			return {
				title: t`This file declares no language.`,
				action: t`Set the document language when exporting.`,
			};
		case "LARGE_FILE_SIZE":
			return {
				title: t`This file is large for a resume.`,
				action: t`Compress or remove large images to keep uploads quick.`,
			};
		case "TRUNCATED_ANALYSIS":
			return {
				title: t`Only the first pages were checked.`,
				action: t`Nothing to fix. The remaining pages were simply not covered by this report.`,
			};
		// ---- Layout ----
		case "MULTI_COLUMN_LAYOUT":
			return {
				title: t`This page is in columns, and the text extracts out of order.`,
				action: t`Use a single column for anything that has to be read in sequence.`,
			};
		case "READING_ORDER_INVERSION":
			return {
				title: t`The order the text is stored in disagrees badly with the order it reads in.`,
				action: t`Re-export from a single-column layout, then copy the text out and check it reads top to bottom.`,
			};
		case "READING_ORDER_RISK":
			return {
				title: t`Some lines are stored out of reading order.`,
				action: t`Copy the text out of the exported file and read it through; fix anything that arrives in the wrong place.`,
			};
		case "COLUMN_GUTTER":
			return {
				title: t`A full-height gap splits this page into two columns.`,
				action: t`Prefer a single column, or keep the side column to short, self-contained lists.`,
			};
		case "TABLE_LIKE_LAYOUT":
			return {
				title: t`Content is laid out in a grid.`,
				action: t`Replace tables with plain paragraphs and lists. Cells extract in storage order, not reading order.`,
			};
		case "TEXT_IN_MARGIN_ZONE":
			return {
				title: t`Text sits in the header or footer area.`,
				action: t`Move real content into the body of the page; some software discards the margins.`,
			};
		case "TIGHT_LINE_SPACING":
			return {
				title: t`Your lines are packed very tightly.`,
				action: t`Increase line spacing so two lines are not merged into one.`,
			};
		case "SMALL_BODY_TEXT":
			return {
				title: t`Your body text is very small.`,
				action: t`Use at least 9pt.`,
			};
		case "MANY_DISTINCT_FONTS":
			return {
				title: t`This file uses a lot of different fonts.`,
				action: t`Keep to two or three families. Each extra font is another chance for one to map badly.`,
			};
		case "NARROW_PAGE_MARGINS":
			return {
				title: t`Your margins are very narrow.`,
				action: t`Leave at least half an inch around the page.`,
			};
		case "TEXT_OUTSIDE_PAGE":
			return {
				title: t`Some text falls outside the page.`,
				action: t`Move all content inside the page boundaries and re-export.`,
			};
		case "NON_STANDARD_BULLET_GLYPHS":
			return {
				title: t`Your bullets are drawn with unusual characters.`,
				action: t`Use your editor's normal bullet list, so stray glyphs do not land mid-sentence.`,
			};
		case "DENSE_PAGE":
			return {
				title: t`This page is very densely packed.`,
				action: t`Add some whitespace between sections so a person can skim it.`,
			};
		case "REPEATED_HEADER_FOOTER":
			return {
				title: t`The same line repeats on every page.`,
				action: t`Keep running heads short, or drop them. They repeat in the extracted text too.`,
			};
		// ---- Sections ----
		case "NO_EXPERIENCE_SECTION":
			return {
				title: t`No work-experience section was found.`,
				action: t`Add a section headed "Experience" or "Work Experience". It is the field most systems rank on.`,
			};
		case "NO_RECOGNIZED_HEADINGS":
			return {
				title: t`No conventional section headings were found.`,
				action: t`Use plain headings such as "Experience", "Education" and "Skills".`,
			};
		case "FEW_SECTION_HEADINGS":
			return {
				title: t`Only one recognizable section heading was found.`,
				action: t`Break the resume into the usual sections so it can be segmented.`,
			};
		case "NO_EDUCATION_SECTION":
			return {
				title: t`No education section was found.`,
				action: t`Add a section headed "Education". Many systems have a required education field.`,
			};
		case "NO_SKILLS_SECTION":
			return {
				title: t`No skills section was found.`,
				action: t`List the tools and technologies you use. Recruiters search skills more than any other field.`,
			};
		case "HEADINGS_NOT_DISTINGUISHED":
			return {
				title: t`Your headings look the same as your body text.`,
				action: t`Make them visibly larger, bolder or capitalized.`,
			};
		case "VERY_SHORT_DOCUMENT":
			return {
				title: t`Very few words were recovered for a resume.`,
				action: t`Check the exported file contains everything you expect, and that all of it is selectable text.`,
			};
		case "NO_BULLET_POINTS":
			return {
				title: t`No bullet lists were found.`,
				action: t`Describe each role with short bullets. Solid paragraphs are harder to skim and to segment.`,
			};
		case "NO_ROLE_LINES":
			return {
				title: t`No lines look like a job title paired with an employer.`,
				action: t`Write each role as a clear title and company line, with the dates alongside.`,
			};
		case "NO_SUMMARY_SECTION":
			return {
				title: t`There is no summary paragraph.`,
				action: t`Add two or three lines at the top describing what you do.`,
			};
		// ---- Contact details ----
		case "NO_EMAIL":
			return {
				title: t`No email address was found.`,
				action: t`Put a plain email address near the top of the first page. It is what most systems file you under.`,
			};
		case "NO_PHONE":
			return {
				title: t`No phone number was found.`,
				action: t`Add one with its country code; some application forms require it before you can submit.`,
			};
		case "NO_NAME_LINE":
			return {
				title: t`The top of the first page does not look like a name.`,
				action: t`Start the resume with your name on its own line.`,
			};
		case "CONTACT_NOT_ON_FIRST_PAGE":
			return {
				title: t`Your contact details are not on the first page.`,
				action: t`Move your email and phone number to the top of page one.`,
			};
		case "EMAIL_SPLIT_ACROSS_ITEMS":
			return {
				title: t`Your email address is broken across pieces of text.`,
				action: t`Write it as one uninterrupted piece, with no special spacing.`,
			};
		case "LINK_TEXT_URL_MISMATCH":
			return {
				title: t`A link points somewhere other than the address it shows.`,
				action: t`Make the visible text and the destination match.`,
			};
		case "MULTIPLE_EMAILS":
			return {
				title: t`More than one email address appears.`,
				action: t`Keep a single address, so software does not have to guess which one to use.`,
			};
		case "NO_PROFESSIONAL_LINK":
			return {
				title: t`There is no link to a profile, portfolio or repository.`,
				action: t`Add one link that shows your work.`,
			};
		case "BARE_URL_WITHOUT_PROTOCOL":
			return {
				title: t`A web address is written without https://.`,
				action: t`Write the full address so it is recognized as a link.`,
			};
		case "PHONE_FORMAT_UNUSUAL":
			return {
				title: t`Your phone number is written in an unusual shape.`,
				action: t`Use a plain international form, such as +1 555 010 1234.`,
			};
		// ---- Dates ----
		case "NO_DATES_FOUND":
			return {
				title: t`No dates were found.`,
				action: t`Give every role a period, such as "Jan 2020 - Present", so your timeline can be reconstructed.`,
			};
		case "FEW_DATES":
			return {
				title: t`Most entries have no dates.`,
				action: t`Give every role and qualification a date range.`,
			};
		case "UNPARSEABLE_DATE_RANGE":
			return {
				title: t`A date range is written in a form most software cannot read.`,
				action: t`Use a recognized form such as "Jan 2020 - Mar 2022" or "2020 - 2022".`,
			};
		case "REVERSED_DATE_RANGE":
			return {
				title: t`A date range ends before it starts.`,
				action: t`Swap the start and end dates.`,
			};
		case "FUTURE_DATED_ENTRY":
			return {
				title: t`A date is in the future.`,
				action: t`Correct the year, or write "Present" for ongoing work.`,
			};
		case "MIXED_DATE_FORMATS":
			return {
				title: t`Your dates are written several different ways.`,
				action: t`Pick one format and use it everywhere.`,
			};
		case "NO_CURRENT_ROLE_MARKER":
			return {
				title: t`Nothing marks a role as ongoing.`,
				action: t`Write "Present" as the end date of your current role.`,
			};
		case "AMBIGUOUS_NUMERIC_DATE":
			return {
				title: t`A numeric date reads differently in different countries.`,
				action: t`Spell the month, as in "Mar 2022".`,
			};
		// ---- Content: unscored advice ----
		case "NO_QUANTIFIED_IMPACT":
			return {
				title: t`Almost none of your bullets carry a number.`,
				action: t`Add figures where you have them: volumes, percentages, timeframes, team sizes.`,
			};
		case "WEAK_ACTION_VERBS":
			return {
				title: t`Most bullets open with filler rather than something you did.`,
				action: t`Start each one with a concrete verb: built, led, reduced, migrated.`,
			};
		case "FIRST_PERSON_PRONOUNS":
			return {
				title: t`Your resume uses "I" and "my".`,
				action: t`Drop the pronouns and start from the verb. That is the convention in most markets.`,
			};
		case "LONG_BULLETS":
			return {
				title: t`Some bullets run long.`,
				action: t`Keep them to roughly two lines, so a skim-reader finishes them.`,
			};
		case "HIGH_PAGE_COUNT":
			return {
				title: t`This resume is long.`,
				action: t`Length is not a defect, and there is no universal one-page rule. Keep the pages that earn their place.`,
			};
		case "EMPLOYMENT_GAP":
			return {
				title: t`There is a gap between two dated roles.`,
				action: t`A gap is not a problem. Add a one-line explanation if you want to; many strong resumes simply do not.`,
			};
		case "ALL_CAPS_RUNS":
			return {
				title: t`Long stretches are set in capitals.`,
				action: t`Reserve capitals for short headings. They slow reading and can defeat case-sensitive search.`,
			};
		case "REPEATED_PHRASES":
			return {
				title: t`Many bullets start with the same phrase.`,
				action: t`Vary the openings so the section does not read as boilerplate.`,
			};
	}
}

export function getPdfCategoryLabel(category: PdfCategory): string {
	switch (category) {
		case "parseability":
			return t`Readability`;
		case "layout":
			return t`Layout`;
		case "sections":
			return t`Sections`;
		case "contact":
			return t`Contact details`;
		case "dates":
			return t`Dates`;
		case "content":
			return t`Writing`;
	}
}
