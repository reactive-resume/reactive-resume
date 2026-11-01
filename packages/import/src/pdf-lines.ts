import type { ExtractedDocument } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { columnSegments } from "@reactive-resume/resume/ats-pdf";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { readLegacyDates } from "@reactive-resume/schema/resume/dates";
import { escapeHtml, generateId } from "@reactive-resume/utils/string";
import { BULLET_PATTERN, toHtmlBlocks } from "./html";
import { allowsPdfGeometry, GeometryIndex, GeometryLimit } from "./pdf-geometry";
import {
	hasContactDetails,
	isContactLine,
	knownHeading,
	parseResumeText,
	standaloneDate,
	findPeriod,
} from "./plain-text";

/**
 * Turns a PDF into the plain lines `parseResumeText` reads.
 *
 * The extraction itself is the ATS checker's — same worker configuration, same size and password
 * guards and font-relative line clustering. Import-specific ordering keeps body columns separate:
 * the ATS text is prose, while the importer splits header rows on runs of two or more spaces, so a
 * tabbed "Company    Role    Location" has to survive as three fields rather than one phrase.
 */

/** Horizontal gap, relative to font size, above which two spans are separate header fields. */
const FIELD_GAP_RATIO = 1.5;
/** Narrower gaps are still a word break; matches the ratio the ATS extractor joins prose with. */
const SPACE_GAP_RATIO = 0.25;

type PageGeometry = ExtractedDocument["pages"][number];
type ImportPage = PageGeometry & { identityRailX?: number };
type TextLine = PageGeometry["lines"][number];
type TextSpan = PageGeometry["lines"][number]["spans"][number];

function fieldsOf(line: TextLine): TextLine[] {
	return columnSegments(line, FIELD_GAP_RATIO).flatMap((field) => {
		const [label, body] = field.spans;
		if (
			!label ||
			!body ||
			!knownHeading(label.text) ||
			label.fontRef === body.fontRef ||
			body.x - label.x - label.width < Math.max(label.fontSize, body.fontSize) * 0.8
		)
			return [field];
		return [lineWithSpans(field, [label]), lineWithSpans(field, field.spans.slice(1))];
	});
}

function joinSpans(spans: readonly TextSpan[]): string {
	let text = "";
	let previous: TextSpan | null = null;

	for (const span of spans) {
		if (previous) {
			const gap = span.x - (previous.x + previous.width);
			const fontSize = Math.max(previous.fontSize, span.fontSize, 1);

			if (gap > FIELD_GAP_RATIO * fontSize) text += "  ";
			else if ((span.spaceBefore || gap > SPACE_GAP_RATIO * fontSize) && !/\s$/.test(text) && !/^\s/.test(span.text))
				text += " ";
		}

		text += span.text;
		previous = span;
	}

	return text.trim();
}

type RecordHeader = { company: string; position: string; location: string; period: string };
type ImportLine = TextLine & {
	heading: boolean;
	identity?: boolean;
	stream: string;
	right?: number | undefined;
	recordDate?: boolean;
	record?: RecordHeader;
};

function lineWithSpans(source: TextLine, spans: readonly TextSpan[]): TextLine {
	const first = spans[0];
	const last = spans.at(-1);
	const dominant = spans.reduce<TextSpan | undefined>(
		(best, span) => (!best || span.text.length > best.text.length ? span : best),
		undefined,
	);
	return {
		...source,
		spans,
		text: joinSpans(spans),
		x: first?.x ?? source.x,
		y: spans.reduce((y, span) => Math.min(y, span.y), first?.y ?? source.y),
		width: first && last ? last.x + last.width - first.x : 0,
		height: spans.reduce((height, span) => Math.max(height, span.height), 0),
		fontRef: dominant?.fontRef ?? source.fontRef,
		fontSize: dominant?.fontSize ?? source.fontSize,
	};
}

const annotationCache = new WeakMap<ExtractedDocument, WeakMap<TextSpan, string>>();
function annotationTarget(doc: ExtractedDocument, span: TextSpan): string | undefined {
	let targets = annotationCache.get(doc);
	if (!targets) {
		targets = new WeakMap();
		const links = new Map<number, NonNullable<ExtractedDocument["links"]>[number][]>();
		for (const link of doc.links ?? []) {
			const page = links.get(link.page) ?? [];
			page.push(link);
			links.set(link.page, page);
		}
		for (const page of doc.pages)
			for (const cell of page.lines.flatMap((line) => line.spans)) {
				const link = links
					.get(page.pageNumber)
					?.find(
						(link) =>
							Boolean(link.url) &&
							cell.x < Math.max(link.rect[0], link.rect[2]) &&
							cell.x + cell.width > Math.min(link.rect[0], link.rect[2]) &&
							cell.y < page.height - Math.min(link.rect[1], link.rect[3]) &&
							cell.y + cell.height > page.height - Math.max(link.rect[1], link.rect[3]),
					);
				if (link?.url) targets.set(cell, link.url);
			}
		annotationCache.set(doc, targets);
	}
	return targets.get(span);
}

/** Separate a corroborated identity rail before its name and an adjacent label become one field. */
function separateIdentityRail(page: PageGeometry): ImportPage {
	const gutter = page.gutter;
	const spans = page.lines.flatMap((line) => line.spans);
	const candidates = gutter && gutter.coverage >= 0.85 ? [gutter.x + gutter.width / 2] : [];
	let edge = 0;
	for (const span of [...spans].sort((a, b) => a.x - b.x)) {
		if (edge && span.x - edge >= Math.max(8, span.fontSize * 0.8)) candidates.push((edge + span.x) / 2);
		edge = Math.max(edge, span.x + span.width);
	}
	for (const x of candidates) {
		if (spans.some((span) => span.x < x && span.x + span.width > x)) continue;
		const sides = [spans.filter((span) => span.x < x), spans.filter((span) => span.x >= x)];
		const rail = sides.some((side, index) => {
			const body = sides[1 - index] ?? [];
			const top = side.reduce((y, span) => Math.min(y, span.y), Infinity);
			const bodyTop = body.reduce((y, span) => Math.min(y, span.y), Infinity);
			return (
				hasContactDetails(side.map((span) => span.text).join("")) &&
				!side.some((span) => standaloneDate(span.text) || BULLET_PATTERN.test(span.text) || knownHeading(span.text)) &&
				body.length > 1 &&
				Math.abs(top - bodyTop) < side.reduce((height, span) => Math.max(height, span.height), 0) * 2
			);
		});
		if (!rail) continue;
		return {
			...page,
			identityRailX: x,
			lines: page.lines.flatMap((line) =>
				sides
					.map((_, index) => line.spans.filter((span) => span.x >= x === (index === 1)))
					.filter((part) => part.length)
					.map((part) => lineWithSpans(line, part)),
			),
		};
	}
	return page;
}

/** Rejoin a label wrapped in a narrow heading rail before testing its typography. */
function joinWrappedLabels(page: PageGeometry): PageGeometry {
	const spans = page.lines.flatMap((line) => line.spans);
	const replacements = new Map<TextSpan, TextSpan>();
	const removed = new Set<TextSpan>();
	for (const span of spans) {
		if (removed.has(span) || knownHeading(span.text)) continue;
		const next = spans
			.filter(
				(other) =>
					other.y > span.y &&
					Math.abs(other.x - span.x) < 1 &&
					other.fontRef === span.fontRef &&
					Math.abs(other.fontSize - span.fontSize) < 1,
			)
			.sort((a, b) => a.y - b.y)[0];
		if (!next || next.y - span.y > span.fontSize * 2 || !knownHeading(span.text + next.text)) continue;
		if (!spans.some((peer) => Math.abs(peer.y - span.y) < span.fontSize && peer.x > span.x + span.width)) continue;
		replacements.set(span, { ...span, text: span.text + next.text });
		removed.add(next);
	}
	return {
		...page,
		lines: page.lines.flatMap((line) => {
			const kept = line.spans.filter((span) => !removed.has(span)).map((span) => replacements.get(span) ?? span);
			return kept.length ? [lineWithSpans(line, kept)] : [];
		}),
	};
}

/** A section label has consistent typography. Body words that happen to be aliases are not labels. */
function headingTest(doc: ExtractedDocument) {
	const headingKeys = new Map<string, ReturnType<typeof knownHeading>>();
	const headingKey = (text: string) => {
		if (headingKeys.has(text)) return headingKeys.get(text) ?? null;
		const key = knownHeading(text);
		headingKeys.set(text, key);
		return key;
	};
	const fields = doc.lines.flatMap(fieldsOf);
	const index = new GeometryIndex(fields);
	const rowIndex = new GeometryIndex(doc.lines, index.budget);
	const spanIndex = new GeometryIndex(
		doc.lines.flatMap((line) => line.spans.map((span) => lineWithSpans(line, [span]))),
		index.budget,
	);
	const sharesRow = (a: TextLine, b: TextLine) =>
		Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > Math.min(a.height, b.height) * 0.5;
	const overlaps = (a: TextLine, b: TextLine) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x);
	const isolationCache = new Map<string, boolean>();
	const cacheKey = (line: TextLine) => `${line.page}:${line.x}:${line.y}:${line.width}:${line.text}`;
	const isolatedRaw = (line: PageGeometry["lines"][number], overlap = false) => {
		let before: PageGeometry["lines"][number] | undefined;
		let after: PageGeometry["lines"][number] | undefined;
		for (const other of index.page(line.page)) {
			if (
				other.page !== line.page ||
				(Math.abs(other.x - line.x) > Math.max(line.fontSize, other.fontSize) &&
					(!overlap || Math.min(other.x + other.width, line.x + line.width) <= Math.max(other.x, line.x)))
			)
				continue;
			if (other.y < line.y - 2 && (!before || other.y > before.y)) before = other;
			if (other.y > line.y + 2 && (!after || other.y < after.y)) after = other;
		}
		if (!before) return true;
		const gapBefore = line.y - before.y - before.height;
		return after ? gapBefore > after.y - line.y - line.height + 2 : gapBefore > before.height + line.height;
	};
	const isolated = (line: TextLine, overlap = false) => {
		const key = cacheKey(line) + overlap;
		const value = isolationCache.get(key);
		if (value !== undefined) return value;
		const result = isolatedRaw(line, overlap);
		isolationCache.set(key, result);
		return result;
	};
	const contacts = index
		.page(1)
		.filter(
			(line) =>
				line.page === 1 &&
				(isContactLine(line.text) || line.spans.filter((span) => isContactLine(span.text)).length > 1),
		)
		.filter(
			(contact) =>
				!index
					.all()
					.some(
						(label) =>
							label.page === 1 &&
							overlaps(label, contact) &&
							label.y < contact.y - 2 &&
							!isContactLine(label.text) &&
							index.page(1).some((before) => before.page === 1 && before.y < label.y - 2 && overlaps(before, label)) &&
							isolated(label, true) &&
							!index
								.all()
								.some((peer) => peer.page === 1 && Math.abs(peer.y - label.y) < 2 && isContactLine(peer.text)),
					),
		);
	const names = index
		.all()
		.filter(
			(line) =>
				line.page === 1 &&
				!headingKey(line.text) &&
				!isContactLine(line.text) &&
				!index.page(1).some((peer) => peer.page === line.page && Math.abs(peer.y - line.y) < 2 && peer.x < line.x) &&
				!index.page(1).some((before) => before.page === 1 && before.y < line.y - 2 && overlaps(before, line)) &&
				index
					.all()
					.some(
						(heading) =>
							heading.page === 1 &&
							((!BULLET_PATTERN.test(heading.text) && headingKey(heading.text) && isolated(heading)) ||
								(heading.text.length <= 48 && /^\p{Lu}[\p{Lu}\s]+$/u.test(heading.text))) &&
							line.fontSize > heading.fontSize * 1.08,
					),
		);
	const legacyIdentity = (line: TextLine) =>
		contacts.some((contact) => contact.spans.some((span) => line.spans.includes(span))) ||
		contacts.some(
			(contact) =>
				line.page === 1 &&
				((line.y < contact.y && overlaps(line, contact)) ||
					(!headingKey(line.text) &&
						Math.abs(line.y - contact.y) < 2 &&
						(doc.pages.find((page) => page.pageNumber === 1) as ImportPage)?.identityRailX === undefined)) &&
				!index
					.all()
					.some(
						(between) =>
							between.page === 1 &&
							between.y > line.y &&
							between.y < contact.y &&
							overlaps(between, line) &&
							headingKey(between.text),
					),
		) ||
		names.some(
			(name) =>
				line.page === 1 &&
				overlaps(line, name) &&
				line.fontRef === name.fontRef &&
				Math.abs(line.fontSize - name.fontSize) < 1,
		);

	const contactAnnotation = (row: TextLine) =>
		row.spans.some((span) => /^(?:mailto:|tel:)/.test(annotationTarget(doc, span) ?? ""));
	const owned = new Set<TextSpan>();
	const confirmedContacts = new Set<TextSpan>();
	let identityColumns: { x: number; top: number } | null = null;
	const page = doc.pages[0];
	if (page) {
		const first = index.all().filter((line) => line.page === 1);
		const known = (line: TextLine) =>
			Boolean(headingKey(line.text)) &&
			!BULLET_PATTERN.test(line.text) &&
			(isolated(line) || line.fontSize > (doc.modalFontSize ?? line.fontSize) * 1.08) &&
			!first.some((other) => headingKey(other.text) === headingKey(line.text) && other.fontSize > line.fontSize * 1.08);
		const columns = bodyColumns(page, known, index);
		identityColumns = columns;
		const groupOf = (line: TextLine) =>
			!columns || line.y < columns.top ? "prefix" : line.x < columns.x ? "left" : "right";
		const groups = new Map<string, TextLine[]>();
		for (const line of first) {
			const key = groupOf(line);
			const group = groups.get(key) ?? [];
			group.push(line);
			groups.set(key, group);
		}
		for (const group of groups.values()) {
			const blocks: TextLine[][] = [];
			// The first block under a section heading is that section's content, even when it carries a phone.
			const headed = new Set<TextLine[]>();
			let block: TextLine[] = [];
			let bottom = -Infinity;
			let afterHeading = false;
			const flush = () => {
				if (block.length) {
					blocks.push(block);
					if (afterHeading) headed.add(block);
					afterHeading = false;
				}
				block = [];
				bottom = -Infinity;
			};
			for (const line of group.sort((a, b) => a.y - b.y || a.x - b.x)) {
				if (known(line)) {
					flush();
					afterHeading = true;
					continue;
				}
				const height = Math.max(line.height, block.at(-1)?.height ?? 0);
				const previous = block.at(-1);
				const contactRow =
					previous &&
					Math.abs(line.fontSize - previous.fontSize) < 1 &&
					line.y - previous.y <= line.fontSize * 2.5 &&
					group.some((peer) => Math.abs(peer.y - line.y) < 2 && peer.spans.some((span) => annotationTarget(doc, span)));
				if (line.y - bottom > height && !contactRow) flush();
				block.push(line);
				bottom = Math.max(bottom, line.y + line.height);
			}
			flush();
			const limit = group
				.filter((line) => standaloneDate(line.text) || BULLET_PATTERN.test(line.text))
				.reduce((y, line) => Math.min(y, line.y), Infinity);
			const contact = blocks.find(
				(rows) =>
					!headed.has(rows) &&
					rows.every((row) => row.y < limit) &&
					rows.some((row) => isContactLine(row.text) || contactAnnotation(row)),
			);
			if (contact) {
				const seed = contact.find((row) => isContactLine(row.text) || contactAnnotation(row));
				const last = contact.at(-1);
				if (seed && last) {
					let bottom = last.y;
					for (const row of group.filter((row) => row.y > bottom).sort((a, b) => a.y - b.y)) {
						if (
							known(row) ||
							standaloneDate(row.text) ||
							Math.abs(row.x - seed.x) > seed.fontSize * 0.25 ||
							row.y - bottom > seed.fontSize * 2.5
						)
							break;
						contact.push(row);
						bottom = row.y;
					}
				}
			}
			if (contact) {
				const text = contact.map((line) => line.text).join("\n");
				index.charge(text.length);
				const annotated = contact.some(contactAnnotation);
				const basics = annotated ? undefined : parseResumeText(text).basics;
				// Contacts may follow Summary; email/phone evidence separates that block from body URLs.
				if (annotated || basics?.email || basics?.phone)
					for (const row of contact) for (const span of row.spans) confirmedContacts.add(span);
			}
			for (const rows of blocks)
				if (
					rows === contact ||
					(rows.every((row) => row.y < limit) &&
						rows.some((row) => names.some((name) => name.spans.some((span) => row.spans.includes(span)))))
				)
					for (const row of rows) for (const span of row.spans) owned.add(span);
		}
	}
	const sectionBefore = (line: TextLine): boolean =>
		index
			.page(line.page)
			.some(
				(label) =>
					headingKey(label.text) &&
					cachedTest(label) &&
					label.y < line.y - 2 &&
					(!identityColumns || label.x < identityColumns.x === line.x < identityColumns.x),
			);
	const identityRaw = (line: TextLine) => {
		if (headingKey(line.text) || standaloneDate(line.text)) return false;
		if (line.spans.every((span) => confirmedContacts.has(span))) return true;
		if (sectionBefore(line)) return false;
		return (
			line.spans.every((span) => owned.has(span)) ||
			(legacyIdentity(line) &&
				(!identityColumns ||
					contacts.some(
						(contact) =>
							contact.page === line.page &&
							line.y < contact.y &&
							overlaps(line, contact) &&
							line.fontSize > contact.fontSize + 0.1,
					)))
		);
	};
	const identityCache = new Map<string, boolean>();
	const identity = (line: TextLine) => {
		const key = cacheKey(line);
		const value = identityCache.get(key);
		if (value !== undefined) return value;
		const result = identityRaw(line);
		identityCache.set(key, result);
		return result;
	};
	const entryHeader = (line: TextLine) => {
		const paired = index
			.near(line, line.fontSize * 4, 2)
			.filter((other) => sameStream(line, other))
			.some(
				(lead) =>
					lead.page === line.page &&
					lead.y <= line.y + 2 &&
					line.y - lead.y < lead.fontSize * 4 &&
					index
						.near(lead, 2, 2)
						.filter((other) => sameStream(lead, other))
						.some(
							(place) =>
								place.page === lead.page &&
								Math.abs(place.y - lead.y) < 2 &&
								place.x > lead.x + lead.width + lead.fontSize &&
								place.fontRef !== lead.fontRef &&
								index
									.near(lead, 0, lead.fontSize * 4)
									.filter((other) => sameStream(lead, other))
									.some(
										(role) =>
											role.page === lead.page &&
											role.y > lead.y + 2 &&
											role.y - lead.y < lead.fontSize * 4 &&
											Math.abs(role.x - lead.x) < lead.fontSize * 0.2 &&
											role.fontRef === place.fontRef &&
											!BULLET_PATTERN.test(role.text) &&
											index
												.near(role, 0, role.fontSize * 2)
												.filter((other) => sameStream(role, other))
												.some(
													(body) =>
														body.page === lead.page &&
														body.y > role.y &&
														body.y - role.y < role.fontSize * 2 &&
														BULLET_PATTERN.test(body.text),
												),
									) &&
								((Math.abs(line.y - lead.y) < 2 &&
									line.x >= lead.x - lead.fontSize * 0.2 &&
									line.x + line.width <= place.x + place.width + lead.fontSize * 0.2) ||
									Math.abs(line.x - lead.x) < lead.fontSize * 0.2),
						),
			);
		if (paired) return true;
		return spanIndex
			.near(line, line.fontSize * 6, line.fontSize * 6)
			.filter((date) => sameStream(line, date))
			.some((date) => {
				if (!standaloneDate(date.text)) return false;
				index.charge(line.spans.length);
				return line.spans.some((part) => {
					const size = Math.max(part.fontSize, date.fontSize);
					if (Math.abs(part.y - date.y) - Math.min(part.height, date.height) > size * 4) return false;
					const cell = lineWithSpans(line, [part]);
					if (
						spanIndex
							.near(cell, Math.max(0, part.y - date.y), Math.max(0, date.y - part.y))
							.some(
								(middle) =>
									middle.y > Math.min(part.y, date.y) + 2 &&
									middle.y < Math.max(part.y, date.y) - 2 &&
									Math.abs(middle.x - part.x) < size &&
									!isContactLine(middle.text),
							)
					)
						return false;
					return (
						Math.abs(part.x + part.width - date.x - date.width) < size ||
						spanIndex
							.near(date, 2, 2)
							.some(
								(lead) =>
									lead.spans[0] !== date.spans[0] && Math.abs(lead.x - part.x) < size && !isContactLine(lead.text),
							)
					);
				});
			});
	};
	const styles = new Map<string, Set<string>>();
	// One heading style can render a tenth of a point apart (8.9 and 9.0), so sizes within 3% of a neighbour in the
	// same font form one style; fixed rounding would split such a style at an arbitrary boundary.
	const sizesByFont = new Map<string, number[]>();
	for (const line of [
		...fields.filter((field) => headingKey(field.text)),
		{ fontRef: doc.modalFontRef, fontSize: doc.modalFontSize ?? 0 },
	]) {
		const sizes = sizesByFont.get(String(line.fontRef)) ?? [];
		sizes.push(line.fontSize);
		sizesByFont.set(String(line.fontRef), sizes);
	}
	const clusters = new Map<string, { from: number; to: number }[]>();
	for (const [font, sizes] of sizesByFont) {
		const runs: { from: number; to: number }[] = [];
		for (const size of sizes.sort((a, b) => a - b)) {
			const run = runs.at(-1);
			if (run && size - run.to <= run.to * 0.03) run.to = size;
			else runs.push({ from: size, to: size });
		}
		clusters.set(font, runs);
	}
	const sizeKey = (font: string | null, size: number) => {
		const run = clusters.get(String(font))?.find((run) => size >= run.from * 0.97 && size <= run.to * 1.03);
		return run ? run.from : Math.round(size * 10) / 10;
	};
	const styleOf = (line: { fontRef: string | null; fontSize: number }) =>
		`${line.fontRef}:${sizeKey(line.fontRef, line.fontSize)}`;
	for (const line of fields) {
		const key = headingKey(line.text);
		if (!key) continue;
		const style = styleOf(line);
		const keys = styles.get(style) ?? new Set<string>();
		keys.add(key);
		styles.set(style, keys);
	}
	const anchored = new Set(
		fields
			.filter(
				(line) =>
					headingKey(line.text) && (line.fontSize > (doc.modalFontSize ?? line.fontSize) * 1.08 || isolated(line)),
			)
			.map(styleOf),
	);
	const streamColumns = new Map<number, { x: number; top: number } | null>();
	const sameStream = (a: TextLine, b: TextLine) => {
		if (a.page !== b.page) return false;
		if (!streamColumns.has(a.page)) {
			const page = doc.pages.find((page) => page.pageNumber === a.page);
			streamColumns.set(
				a.page,
				page
					? bodyColumns(
							page,
							(line) => Boolean(headingKey(line.text)) || (anchored.has(styleOf(line)) && isolated(line)),
							index,
						)
					: null,
			);
		}
		const cut = streamColumns.get(a.page);
		return !cut || a.y < cut.top || b.y < cut.top || a.x < cut.x === b.x < cut.x;
	};
	// Isolation is evidence a body paragraph can also produce (a blank line, a page top), so an anchored style can be a
	// run of labels inside sections' content. Such a style is nested: every label of it lies inside a section opened by
	// another anchored style with several labels. Nested labels stay content and do not set the alias bar, however many
	// keys they carry.
	const labelsByStyle = new Map<string, TextLine[]>();
	for (const line of fields) {
		if (!headingKey(line.text) || !anchored.has(styleOf(line))) continue;
		const labels = labelsByStyle.get(styleOf(line)) ?? [];
		labels.push(line);
		labelsByStyle.set(styleOf(line), labels);
	}
	// A section runs on across pages and down its column.
	const below = (label: TextLine, line: TextLine) =>
		label.page < line.page || (label.page === line.page && label.y < line.y - 2 && sameStream(line, label));
	const within = (inner: TextLine[], outer: TextLine[]) => {
		index.charge(inner.length * outer.length);
		return inner.every((line) => outer.some((label) => below(label, line)));
	};
	const nested = new Set(
		[...labelsByStyle].flatMap(([style, labels]) =>
			[...labelsByStyle].some(([other, sections]) => other !== style && sections.length > 1 && within(labels, sections))
				? [style]
				: [],
		),
	);
	const established = new Set([...anchored].filter((style) => !nested.has(style)));
	const mostKeys = Array.from(
		established.size ? established : styles.keys(),
		(style) => styles.get(style)?.size ?? 0,
	).reduce((most, keys) => Math.max(most, keys), 0);
	const test = (line: PageGeometry["lines"][number]) => {
		if (isContactLine(line.text) || identity(line) || BULLET_PATTERN.test(line.text)) return false;
		const consistent = (styles.get(styleOf(line))?.size ?? 0) >= Math.max(1, mostKeys);
		const larger =
			line.fontSize > (doc.modalFontSize ?? line.fontSize) * 1.08 ||
			rowIndex
				.near(line, 0, line.fontSize * 6)
				.some(
					(row) =>
						row.y > line.y &&
						row.y - line.y < line.fontSize * 6 &&
						row.x <= line.x &&
						row.x + row.width >= line.x + line.width &&
						dateSpans(row).length &&
						line.fontSize > row.fontSize * 1.08,
				);
		if (
			headingKey(line.text) &&
			index.all().some(
				(other) =>
					headingKey(other.text) === headingKey(line.text) &&
					other.fontSize > line.fontSize * 1.08 &&
					isolated(other) &&
					// A larger label nested in a section's content is not a competing heading.
					!nested.has(styleOf(other)),
			)
		)
			return false;
		const distinct =
			line.fontRef !== doc.modalFontRef || Math.abs(line.fontSize - (doc.modalFontSize ?? line.fontSize)) > 1;
		if (headingKey(line.text) && nested.has(styleOf(line))) return larger;
		if (headingKey(line.text))
			return (
				larger ||
				(consistent && established.has(styleOf(line)) && (distinct || isolated(line))) ||
				(/^[A-Z][A-Z\s]+$/.test(line.text) && (isolated(line) || (consistent && !anchored.size)))
			);

		if (line.spans.some((span) => annotationTarget(doc, span)) && !established.has(styleOf(line))) return false;
		if (
			!established.has(styleOf(line)) &&
			!larger &&
			index
				.all()
				.some(
					(label) =>
						headingKey(label.text) &&
						(label.page < line.page || (label.page === line.page && label.y < line.y - 2)) &&
						(label.page === line.page ? sameStream(line, label) : overlaps(line, label)),
				)
		)
			return false;
		if (entryHeader(line)) return false;
		const letters = line.text.replace(/[^\p{L}]/gu, "");
		const capitalized =
			letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
		const page = doc.pages.find((page) => page.pageNumber === line.page);
		const centered = page && Math.abs(line.x + line.width / 2 - page.width / 2) < line.fontSize;
		const followingBody = index
			.all()
			.some(
				(other) =>
					other.page === line.page &&
					(other.y > line.y + 2 ||
						(Math.abs(other.y - line.y) < 2 &&
							other.x > line.x + line.width &&
							(other.fontRef !== line.fontRef || Math.abs(other.fontSize - line.fontSize) > 1))) &&
					other.y < line.y + line.height * 4 &&
					(centered ||
						Math.min(other.x + other.width, line.x + line.width) > Math.max(other.x, line.x) ||
						(Math.abs(other.y - line.y) < 2 && other.x > line.x + line.width)) &&
					!identity(other),
			);
		const startsBody =
			!index
				.page(line.page)
				.some(
					(other) =>
						headingKey(other.text) &&
						other.y < line.y - 2 &&
						(!identityColumns || other.x < identityColumns.x === line.x < identityColumns.x),
				) &&
			!index
				.all()
				.some(
					(other) =>
						(other.page < line.page || (other.page === line.page && other.y < line.y - 2)) &&
						overlaps(line, other) &&
						!identity(other),
				);
		const labelledRow = index
			.all()
			.some(
				(label) =>
					label.page === line.page &&
					label.x < line.x &&
					!hasContactDetails(label.text) &&
					sharesRow(label, line) &&
					((headingKey(label.text) && anchored.has(styleOf(label))) ||
						(label.fontSize < line.fontSize &&
							isolated(label, true) &&
							!index
								.all()
								.some(
									(before) =>
										before.page === label.page &&
										before.y < label.y - 2 &&
										overlaps(before, label) &&
										!identity(before),
								))) &&
					!index
						.all()
						.some(
							(body) =>
								body.page === line.page &&
								body.y > label.y + 2 &&
								overlaps(body, label) &&
								!headingKey(body.text) &&
								!identity(body),
						),
			);
		const independent =
			(capitalized || startsBody || (consistent && established.has(styleOf(line)) && isolated(line, true))) &&
			followingBody &&
			(startsBody || isolated(line, true)) &&
			!labelledRow;
		if (/[.!?;,]$/.test(line.text.trim()) && !independent) return false;
		return (
			((consistent && established.has(styleOf(line))) || independent) &&
			(independent || distinct || (capitalized && isolated(line))) &&
			(capitalized ? line.text.replace(/\s/g, "").length : line.text.length) <= 48 &&
			(line.text.split(/\s+/).length <= 6 || capitalized) &&
			(!/\d/.test(line.text) || independent)
		);
	};
	const testCache = new Map<string, boolean>();
	const cachedTest = (line: TextLine) => {
		const key = cacheKey(line);
		const value = testCache.get(key);
		if (value !== undefined) return value;
		const result = test(line);
		testCache.set(key, result);
		return result;
	};
	return Object.assign(cachedTest, { identity, index });
}

/** Find the actual empty band, not the heading's inset: sidebar text may start left of its heading. */
function bodyColumns(
	page: ImportPage,
	isHeading: (line: TextLine) => boolean,
	index: GeometryIndex,
): { x: number; top: number } | null {
	if (page.identityRailX !== undefined) return { x: page.identityRailX, top: 0 };
	const headings = page.lines.flatMap(fieldsOf).filter(isHeading);
	const headingSpans = new Set(headings.flatMap((heading) => heading.spans));
	const fields = page.lines.flatMap(fieldsOf);
	const dates = fields.filter((line) => standaloneDate(line.text) !== "");
	const bodySpans = new Set(
		fields
			.filter(
				(line) =>
					!hasContactDetails(line.text) &&
					!standaloneDate(line.text) &&
					!dates.some(
						(date) =>
							date.y > line.y &&
							date.y - line.y < line.height * 2 &&
							Math.abs(date.x + date.width - line.x - line.width) < line.fontSize,
					),
			)
			.flatMap((line) => line.spans)
			.filter((span) => !headingSpans.has(span)),
	);
	const starts = new Set<number>([0]);
	// Aligned section labels provide evidence of a body below a full-width header.
	let band: { y: number; size: number; left: number; right: number } | null = null;
	for (const heading of headings) {
		if (!band || heading.y - band.y > Math.max(band.size, heading.fontSize) * 2) {
			band = { y: heading.y, size: heading.fontSize, left: heading.x, right: heading.x };
		} else {
			band.left = Math.min(band.left, heading.x);
			band.right = Math.max(band.right, heading.x);
			if (band.right - band.left > Math.max(band.size, heading.fontSize) * 2) starts.add(band.y);
		}
	}
	for (const top of starts) {
		const spans = page.lines
			.filter((line) => line.y >= top)
			.flatMap((line) => line.spans)
			.sort((a, b) => a.x - b.x);
		let edge = spans[0]?.x ?? 0;
		const cuts: number[] = [];
		for (const span of spans) {
			if (span.x - edge >= Math.max(8, span.fontSize * 0.8)) cuts.push((edge + span.x) / 2);
			edge = Math.max(edge, span.x + span.width);
		}
		for (const x of cuts) {
			index.charge(spans.length * (headings.length + 4));
			const rightOrigin = headings
				.filter((heading) => heading.x >= x)
				.reduce((edge, heading) => Math.min(edge, heading.x), Infinity);
			const dateCells = page.lines.flatMap((line) => line.spans).filter((span) => standaloneDate(span.text));
			index.charge(dateCells.length * fields.length);
			if (
				dateCells.some(
					(date) =>
						date.x >= x &&
						date.x + date.width < rightOrigin &&
						fields.some(
							(lead) =>
								lead.x < x &&
								Math.abs(lead.y + lead.height - date.y - date.height) < 2 &&
								!standaloneDate(lead.text) &&
								!hasContactDetails(lead.text),
						),
				)
			)
				continue;
			// Two right-aligned place/date fields are a header, not an independent sidebar.
			const leftHeading = headings.some((heading) => heading.x < x);
			const rightHeading = headings.some((heading) => heading.x >= x);
			const headingSize = headings.reduce(
				(size, heading) => Math.min(size, heading.fontSize),
				Number.POSITIVE_INFINITY,
			);
			const identitySide = spans.some(
				(span) =>
					bodySpans.has(span) &&
					span.fontSize > headingSize * 1.08 &&
					(span.x < x ? !leftHeading : !rightHeading) &&
					headings.some((heading) => heading.x < x !== span.x < x && Math.abs(heading.y - span.y) < span.fontSize),
			);
			if (!(leftHeading && rightHeading) && !identitySide) continue;
			const sides = [spans.filter((span) => span.x < x), spans.filter((span) => span.x >= x)];
			// A heading rail (Bronzor) is one reading stream, not a sidebar. Both sides need body text.
			if (
				sides.every(
					(side) =>
						new Set(side.filter((span) => bodySpans.has(span)).map((span) => Math.round(span.y))).size >=
						(identitySide ? 1 : 2),
				)
			)
				return { x, top };
		}
	}
	return null;
}

function pageToLines(
	page: PageGeometry,
	isHeading: ReturnType<typeof headingTest>,
	previousColumns: { x: number; top: number } | null,
) {
	const makeLine = (source: PageGeometry["lines"][number], spans = source.spans): ImportLine => {
		const line = lineWithSpans(source, spans);
		return { ...line, heading: isHeading(line), identity: isHeading.identity(line), stream: "main" };
	};
	const carry =
		previousColumns &&
		page.lines.every((line) =>
			line.spans.every((span) => span.x >= previousColumns.x || span.x + span.width <= previousColumns.x),
		)
			? { ...previousColumns, top: 0 }
			: null;
	const columns = bodyColumns(page, isHeading, isHeading.index) ?? carry;
	const streams: ImportLine[][] = columns ? [[], [], []] : [[]];
	for (const source of page.lines) {
		if (!columns) {
			streams[0]?.push(makeLine(source));
			continue;
		}
		if (source.y + source.height <= columns.top) {
			streams[0]?.push(makeLine(source));
			continue;
		}
		for (const [side, index] of [
			[false, 1],
			[true, 2],
		] as const) {
			const spans = source.spans.filter((span) => span.x >= columns.x === side);
			if (spans.length) streams[index]?.push(makeLine(source, spans));
		}
	}
	// Header contact details belong before the sections, even when they sit above just one column.
	if (columns && page.pageNumber === 1) {
		for (const stream of streams.slice(1)) {
			const firstHeading = stream.findIndex((line) => fieldsOf(line).some((field) => knownHeading(field.text)));
			if (firstHeading > 0) streams[0]?.push(...stream.splice(0, firstHeading));
		}
		streams[0]?.sort((a, b) => a.y - b.y || a.x - b.x);
	}
	const expand = (stream: ImportLine[], kind: ImportLine["stream"]) =>
		stream
			.flatMap((line) => {
				const fields = fieldsOf(line);
				if (fields.length <= 1 || !fields.some(isHeading)) return [line];
				const result: ImportLine[] = [];
				let content: TextSpan[] = [];
				const flush = () => {
					if (content.length) result.push(makeLine(line, content));
					content = [];
				};
				for (const field of fields) {
					if (isHeading(field)) {
						flush();
						result.push(makeLine(field));
					} else content.push(...field.spans);
				}
				flush();
				return result;
			})
			.map((line) => ({
				...line,
				stream: kind,
				right: columns && (kind === "sidebar") === (sidebarIndex === 1) ? columns.x : page.width - page.margins.right,
			}));
	const sidebarIndex = columns && columns.x < page.width / 2 ? 1 : 2;
	return {
		columns,
		prefix: columns ? expand(streams[0] ?? [], "prefix") : [],
		sidebar: columns ? expand(streams[sidebarIndex] ?? [], "sidebar") : [],
		main: expand(streams[columns ? 3 - sidebarIndex : 0] ?? [], "main"),
	};
}

const dateSpans = (line: TextLine) => line.spans.filter((span) => span.text.trim() && standaloneDate(span.text) !== "");

/** Parallel date cells corroborate item columns even when the gutter is narrower than a word-field gap. */
function splitExperienceItems(source: ImportLine[]): ImportLine[] {
	const out: ImportLine[] = [];
	for (let start = 0; start < source.length;) {
		const heading = source[start];
		if (!heading) {
			start++;
			continue;
		}
		out.push(heading);
		start++;
		if (!heading.heading || knownHeading(heading.text) !== "experience") continue;
		let end = start;
		while (end < source.length && !source[end]?.heading) end++;
		const run = source.slice(start, end);
		const paired = run.find((line) => dateSpans(line).length > 1);
		if (!paired) {
			out.push(...run);
			start = end;
			continue;
		}
		const dates = dateSpans(paired).sort((a, b) => a.x - b.x);
		const cuts: number[] = [];
		for (const date of dates.slice(0, -1)) {
			const after =
				run
					.filter((row) => row.page === paired.page && row.y <= paired.y)
					.flatMap((row) => row.spans)
					.filter((span) => span.x >= date.x + date.width - 0.1 && span !== date && !dateSpans(paired).includes(span))
					.sort((a, b) => a.x - b.x)[0] ??
				paired.spans.find((span) => span.x >= date.x + date.width - 0.1 && span !== date);
			if (after) cuts.push((date.x + date.width + after.x) / 2);
		}
		if (!cuts.length) {
			out.push(...run);
			start = end;
			continue;
		}
		const sideOf = (span: TextSpan) => cuts.filter((x) => span.x >= x).length;
		const origins = dates.map((date, i) =>
			run
				.filter((row) => row.page === paired.page && row.y <= paired.y)
				.flatMap((row) => row.spans)
				.filter((span) => sideOf(span) === i && !dateSpans(paired).includes(span))
				.reduce((x, span) => Math.min(x, span.x), date.x),
		);
		const bands: number[] = [];
		for (const [i, line] of run.entries()) {
			if (
				!dateSpans(line).length ||
				(dateSpans(line).length < 2 &&
					!line.spans.some(
						(span) =>
							!dateSpans(line).includes(span) &&
							Math.abs(span.x - (origins[sideOf(span)] ?? span.x)) < span.fontSize * 0.2,
					))
			)
				continue;
			const previous = run[i - 1];
			const headerAbove =
				previous &&
				previous.page === line.page &&
				!BULLET_PATTERN.test(previous.text) &&
				!dateSpans(previous).length &&
				previous.spans.some((span) => Math.abs(span.x - (origins[sideOf(span)] ?? Infinity)) < span.fontSize * 0.2);
			let begin = headerAbove ? i - 1 : i;
			while (begin > 0) {
				const prior = run[begin - 1];
				if (!prior || prior.page !== line.page || BULLET_PATTERN.test(prior.text) || dateSpans(prior).length) break;
				begin--;
			}
			if (bands.at(-1) !== begin) bands.push(begin);
		}
		if (!bands.length) {
			out.push(...run);
			start = end;
			continue;
		}
		out.push(...run.slice(0, bands[0]));
		for (const [band, index] of bands.entries()) {
			const rows = run.slice(index, bands[band + 1] ?? run.length);
			for (let side = 0; side <= cuts.length; side++)
				for (const row of rows) {
					const spans = row.spans.filter((span) => sideOf(span) === side);
					if (!spans.length) continue;
					out.push({
						...lineWithSpans(row, spans),
						heading: false,
						stream: `${row.stream}:items:${band}:${side}`,
						right: cuts[side] ?? row.right,
					});
				}
		}
		start = end;
	}
	return out;
}

/** Fold wrapped stacked fields by their left/right lanes before assigning their semantic roles. */
function foldStackedHeaders(source: ImportLine[]): ImportLine[] {
	const out: ImportLine[] = [];
	let experience = false;
	for (const line of source) {
		if (line.heading) experience = knownHeading(line.text) === "experience";
		if (experience && BULLET_PATTERN.test(line.text)) {
			let start = out.length;
			while (start > 0) {
				const prior = out[start - 1];
				if (
					!prior ||
					prior.heading ||
					prior.identity ||
					prior.stream !== line.stream ||
					BULLET_PATTERN.test(prior.text) ||
					prior.record
				)
					break;
				start--;
			}
			const rows = out.slice(start);
			const spans = rows.flatMap((row) => row.spans);
			const dates = spans.filter((span) => standaloneDate(span.text));
			const date = dates[0];
			const text = spans.filter((span) => !dates.includes(span));
			const left = text.reduce((x, span) => Math.min(x, span.x), Infinity);
			const leftRuns = text.filter((span) => Math.abs(span.x - left) < span.fontSize * 0.2);
			const lead = leftRuns.find((span) => span.fontRef !== (date?.fontRef ?? leftRuns.at(-1)?.fontRef));
			if (lead) {
				const first = rows.findIndex((row) => row.spans.includes(lead));
				const dateRow = date ? rows.findIndex((row) => row.spans.includes(date)) : -1;
				const headerRows = rows.slice(first, dateRow >= 0 ? dateRow + 1 : undefined);
				const headerSpans = headerRows.flatMap((row) => row.spans);
				const content = headerSpans.filter((span) => !dates.includes(span));
				const right = date ? date.x + date.width : (headerRows[0]?.right ?? Infinity);
				const place = content.filter(
					(span) => span.x > left + span.fontSize && Math.abs(span.x + span.width - right) < span.fontSize,
				);
				const strong = content.filter(
					(span) => span.fontRef === lead.fontRef && Math.abs(span.x - left) < span.fontSize * 0.2,
				);
				const regular = content.filter(
					(span) => span.fontRef !== lead.fontRef && Math.abs(span.x - left) < span.fontSize * 0.2,
				);
				const accounted = new Set([...place, ...strong, ...regular]);
				if (
					place.length &&
					strong.length &&
					regular.length &&
					content.every((span) => accounted.has(span)) &&
					!content.some((span) => span.text.includes(" · "))
				) {
					const joined = (parts: TextSpan[]) => parts.map((span) => span.text).join(" ");
					const roleFirst =
						content.findIndex((span) => span === place[0]) > content.findIndex((span) => span === regular[0]);
					const record = {
						company: joined(roleFirst ? regular : strong),
						position: joined(roleFirst ? strong : regular),
						location: joined(place),
						period: date?.text.trim() ?? "",
					};
					const origin = headerRows[0];
					if (origin) {
						const tail = out.splice(start + first + headerRows.length);
						out.splice(start + first, headerRows.length);
						out.push({
							...origin,
							text: `${record.company}  ${record.position}  ${record.location}`,
							spans: content,
							record,
						});
						if (date)
							out.push({
								...origin,
								...lineWithSpans(origin, [date]),
								page: headerRows.find((row) => row.spans.includes(date))?.page ?? origin.page,
								recordDate: true,
							});
						out.push(...tail);
					}
				}
			}
		}
		out.push(line);
	}
	return out;
}

/** Wrapped header dates stay with the adjacent header in their own item stream. */
function attachRecordDates(source: ImportLine[]): ImportLine[] {
	const lines: ImportLine[] = [];
	let experience = false;
	for (const line of source) {
		if (line.heading) experience = knownHeading(line.text) === "experience";
		const previous = lines.at(-1);
		if (
			experience &&
			previous &&
			!previous.heading &&
			!previous.record &&
			previous.stream === line.stream &&
			previous.page === line.page &&
			!BULLET_PATTERN.test(previous.text) &&
			!dateSpans(previous).length &&
			line.spans.length === dateSpans(line).length &&
			(line.spans[0]?.x ?? 0) > previous.x + previous.fontSize
		) {
			lines[lines.length - 1] = {
				...previous,
				...lineWithSpans(previous, [...previous.spans, ...line.spans]),
				text: `${previous.text}  ${line.text}`,
			};
		} else lines.push(line);
	}
	return lines;
}

/** Record fields remain structured; delimiters in a company or title never become parser syntax. */
function orderExperienceHeaders(source: ImportLine[]): ImportLine[] {
	const out: ImportLine[] = [];
	let experience = false;
	const parts = (line: ImportLine, withoutDates = false) => {
		const spans = withoutDates ? line.spans.filter((span) => !dateSpans(line).includes(span)) : line.spans;
		if (!spans.length) return [];
		return fieldsOf(lineWithSpans(line, spans));
	};
	const stackedParts = (line: ImportLine) => {
		const fields = parts(line);
		if (fields.length !== 1) return fields;
		const first = line.spans[0];
		const boundary = line.spans.findIndex((span) => span.fontRef !== first?.fontRef);
		return boundary > 0
			? [lineWithSpans(line, line.spans.slice(0, boundary)), lineWithSpans(line, line.spans.slice(boundary))]
			: fields;
	};
	const details = (text: string) => {
		const index = text.lastIndexOf(" · ");
		return index < 0 ? null : { position: text.slice(0, index).trim(), location: text.slice(index + 3).trim() };
	};
	for (let i = 0; i < source.length; i++) {
		const line = source[i];
		if (!line) continue;
		if (line.heading) {
			experience = knownHeading(line.text) === "experience";
			out.push(line);
			continue;
		}
		if (line.record || line.recordDate || !experience || BULLET_PATTERN.test(line.text) || !dateSpans(line).length) {
			out.push(line);
			continue;
		}
		const period = dateSpans(line)[0]?.text.trim() ?? "";
		const current = parts(line, true);
		const previous = out.at(-1);
		const next = source[i + 1];
		const same = (other: ImportLine | undefined) =>
			other &&
			!other.heading &&
			other.stream === line.stream &&
			other.page <= line.page &&
			!BULLET_PATTERN.test(other.text) &&
			!dateSpans(other).length;
		const before = same(previous) ? previous : undefined;
		const after = same(next) ? next : undefined;
		const lead = current
			.map((p) => p.text)
			.join(" ")
			.trim();
		let record: RecordHeader | undefined;
		let first = line;
		let takeNext = false;
		const above = before ? details(before.text) : null;
		const below = after ? details(after.text) : null;
		if (above && current.length === 1) {
			record = { company: lead, ...above, period };
			first = before ?? line;
			out.pop();
		} else if (below && current.length === 1) {
			record = { company: lead, ...below, period };
			takeNext = true;
		} else if (current.length === 1 && /\([^()]*\)/.test(lead)) {
			const textSpans = line.spans.filter((span) => !dateSpans(line).includes(span));
			const firstSpan = textSpans[0];
			const boundary = textSpans.findIndex(
				(span) => span.fontRef !== firstSpan?.fontRef || Math.abs(span.fontSize - (firstSpan?.fontSize ?? 0)) > 1,
			);
			const match = /^(.*?)\s*\(([^()]*)\)\s*(.*)$/.exec(lead);
			if (match && boundary > 0) {
				const leading = joinSpans(textSpans.slice(0, boundary));
				const tail = joinSpans(textSpans.slice(boundary));
				const tailMatch = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(tail);
				record = match[3]
					? { company: match[3], position: match[1] ?? "", location: match[2] ?? "", period }
					: tailMatch
						? { company: leading, position: tailMatch[1] ?? "", location: tailMatch[2] ?? "", period }
						: undefined;
			}
		} else if (before) {
			const prior = stackedParts(before);
			const a = prior[0];
			const b = prior[1];
			if (
				a &&
				b &&
				a.fontRef !== line.fontRef &&
				(Math.abs(b.x + b.width - (dateSpans(line)[0]?.x ?? 0) - (dateSpans(line)[0]?.width ?? 0)) < b.fontSize ||
					(Math.abs(a.x - (current[0]?.x ?? Infinity)) < a.fontSize &&
						b.x > (current[0]?.x ?? Infinity) + (current[0]?.width ?? 0)))
			) {
				record = { company: a.text, position: lead, location: b.text, period };
				first = before;
				out.pop();
			}
		}
		if (!record && after) {
			const following = stackedParts(after);
			const a = following[0];
			const b = following[1];
			if (a && b && a.fontRef !== line.fontRef) {
				record = { company: a.text, position: lead, location: b.text, period };
				takeNext = true;
			}
		}
		if (!record && current.length === 1) {
			const runs = line.spans.filter((span) => !dateSpans(line).includes(span));
			const boundary = runs.findIndex((span) => span.fontRef !== runs[0]?.fontRef);
			if (boundary > 0)
				record = {
					company: joinSpans(runs.slice(0, boundary)),
					position: joinSpans(runs.slice(boundary)),
					location: "",
					period,
				};
			else if (
				after &&
				parts(after).length === 1 &&
				after.fontRef !== line.fontRef &&
				after.y - line.y <= Math.max(line.fontSize, after.fontSize) * 2
			) {
				record = { company: lead, position: after.text, location: "", period };
				takeNext = true;
			}
		}
		if (!record) {
			out.push(line);
			continue;
		}
		out.push({ ...first, text: `${record.company}  ${record.position}  ${record.location}`, heading: false, record });
		out.push({ ...line, text: period, heading: false, recordDate: true, spans: dateSpans(line) });
		if (takeNext) i++;
	}
	return out;
}

/** A marker may have its own baseline when its item's local font size or leading changes. */
function attachListMarkers(source: ImportLine[]): ImportLine[] {
	const lines: ImportLine[] = [];
	for (let i = 0; i < source.length; i++) {
		const line = source[i];
		if (!line) continue;
		const marker = line.spans[0];
		const next = source[i + 1];
		const content = next?.spans[0];
		if (
			marker &&
			next &&
			content &&
			line.spans.length === 1 &&
			BULLET_PATTERN.test(line.text) &&
			!line.text.replace(BULLET_PATTERN, "") &&
			line.page === next.page &&
			line.stream === next.stream &&
			content.x > marker.x &&
			content.x - marker.x < Math.max(marker.fontSize, content.fontSize) * 2 &&
			Math.abs(content.y + content.height - marker.y - marker.height) <
				Math.max(marker.fontSize, content.fontSize) * 1.5 &&
			!BULLET_PATTERN.test(next.text) &&
			!dateSpans(next).length
		) {
			lines.push({ ...line, ...lineWithSpans(line, [marker, ...next.spans]), heading: false });
			i++;
		} else lines.push(line);
	}
	return lines;
}

function importLines(source: ExtractedDocument): ImportLine[] {
	const pages = source.pages.map(joinWrappedLabels).map(separateIdentityRail);
	const doc = { ...source, pages, lines: pages.flatMap((page) => page.lines) };
	const isHeading = headingTest(doc);
	const lines: ImportLine[] = [];
	let bullet: {
		x: number;
		markerX: number;
		size: number;
		font: string;
		last: TextSpan;
		page: number;
		stream: ImportLine["stream"];
		leading?: number;
		line: ImportLine;
		right: number;
	} | null = null;
	const prefix: ImportLine[] = [];
	const sidebar: ImportLine[] = [];
	const main: ImportLine[] = [];
	const all: ImportLine[] = [];
	const flush = () => {
		all.push(...prefix, ...sidebar, ...main);
		prefix.length = 0;
		sidebar.length = 0;
		main.length = 0;
	};
	let columns: { x: number; top: number } | null = null;
	for (const page of doc.pages) {
		const streams = pageToLines(page, isHeading, columns);
		// A new full-width section ends the preceding column group. Without it,
		// retain cross-page column streams so sidebar continuations keep their owner.
		if ((sidebar.length || main.length) && streams.prefix.some((line) => line.heading)) flush();
		columns = streams.columns;
		prefix.push(...streams.prefix);
		sidebar.push(...streams.sidebar);
		main.push(...streams.main);
	}
	flush();
	const ordered = attachListMarkers(
		orderExperienceHeaders(
			attachRecordDates(
				foldStackedHeaders(
					splitExperienceItems([...all.filter((line) => line.identity), ...all.filter((line) => !line.identity)]),
				),
			),
		),
	);
	const baseline = (span: TextSpan) => span.y + span.height;
	const wrapsInto = (previous: ImportLine, next: TextSpan, observedRight?: number) => {
		const right =
			observedRight ?? previous.right ?? doc.pages.find((page) => page.pageNumber === previous.page)?.width ?? 0;
		const edge = previous.spans.reduce((x, span) => Math.max(x, span.x + span.width), previous.x);
		const word = next.text.trim().split(/\s+/)[0] ?? "";
		const wordWidth = (next.width * word.length) / Math.max(1, next.text.length);
		return right - edge <= Math.max(wordWidth, next.fontSize) * 1.5;
	};
	let inDescription = false;
	for (const [index, line] of ordered.entries()) {
		if (line.heading) inDescription = knownHeading(line.text) === null;
		if (line.record) inDescription = true;
		const first = line.spans[0];
		if (!first || !line.text) continue;
		const following = ordered[index + 1];
		const followingFirst = following?.spans[0];
		const nextGap =
			following &&
			followingFirst &&
			following.stream === line.stream &&
			following.page === line.page &&
			!BULLET_PATTERN.test(following.text) &&
			Math.abs(followingFirst.x - first.x) < first.fontSize * 0.2 &&
			Math.abs(followingFirst.fontSize - first.fontSize) < 1
				? baseline(followingFirst) - baseline(first)
				: undefined;
		const gap = bullet ? baseline(first) - baseline(bullet.last) : 0;
		const credible =
			bullet &&
			(bullet.leading !== undefined
				? Math.abs(gap - bullet.leading) <= first.fontSize * 0.15
				: nextGap !== undefined && nextGap > 0
					? Math.abs(gap - nextGap) <= first.fontSize * 0.15
					: gap <= first.fontSize * 1.5 + first.fontSize * 0.15 || wrapsInto(bullet.line, first));

		if (BULLET_PATTERN.test(line.text)) {
			const content =
				BULLET_PATTERN.test(first.text) && !first.text.replace(BULLET_PATTERN, "") ? line.spans[1] : first;
			bullet = {
				x: content?.x ?? first.x,
				markerX: first.x,
				size: content?.fontSize ?? first.fontSize,
				font: content?.fontRef ?? first.fontRef,
				last: content ?? first,
				line,
				right: Math.max(...line.spans.map((span) => span.x + span.width)),
				page: line.page,
				stream: line.stream,
			};
		} else if (
			bullet &&
			!line.record &&
			!line.recordDate &&
			line.stream === bullet.stream &&
			(!line.heading || (first.fontRef === bullet.font && Math.abs(first.x - bullet.x) < bullet.size * 0.2)) &&
			Math.abs(first.fontSize - bullet.size) < 1 &&
			(first.fontRef === bullet.font || wrapsInto(bullet.line, first)) &&
			((line.page === bullet.page &&
				gap > 0 &&
				gap <= first.fontSize * 4 &&
				first.x > bullet.markerX &&
				Math.abs(first.x - bullet.x) <= bullet.size * 0.9 &&
				credible) ||
				(line.page > bullet.page &&
					wrapsInto(bullet.line, first, bullet.leading === undefined ? undefined : bullet.right) &&
					first.x > bullet.markerX &&
					Math.abs(first.x - bullet.x) <= bullet.size * 0.9 &&
					fieldsOf(line).length === 1))
		) {
			const previous = lines.at(-1);
			if (previous) previous.text += ` ${line.text}`;
			if (line.page !== bullet.page) bullet.markerX = first.x - (bullet.x - bullet.markerX);
			bullet.x = first.x;
			if (line.page === bullet.page) bullet.leading ??= gap;
			bullet.last = first;
			const edge = Math.max(...line.spans.map((span) => span.x + span.width));
			bullet.right = line.page === bullet.page ? Math.max(bullet.right, edge) : edge;
			bullet.line = line;
			bullet.page = line.page;
			continue;
		} else bullet = null;
		const previous = lines.at(-1);
		const previousSpan = previous?.spans[0];
		if (
			!inDescription &&
			previous &&
			previousSpan &&
			!line.heading &&
			isContactLine(previous.text) &&
			!isContactLine(line.text) &&
			!/\s/.test(line.text) &&
			previous.stream === line.stream &&
			previous.page === line.page &&
			first.fontRef === previousSpan.fontRef &&
			Math.abs(first.x - previousSpan.x) < first.fontSize * 0.2 &&
			baseline(first) - baseline(previousSpan) > 0 &&
			baseline(first) - baseline(previousSpan) <= first.fontSize * 1.6 &&
			wrapsInto(previous, first)
		) {
			previous.text += line.text;
			previous.spans = line.spans;
			previous.y = line.y;
			continue;
		}

		if (
			inDescription &&
			previous &&
			previousSpan &&
			!previous.heading &&
			!previous.record &&
			!line.heading &&
			!line.record &&
			!BULLET_PATTERN.test(previous.text) &&
			!BULLET_PATTERN.test(line.text) &&
			!dateSpans(previous).length &&
			!dateSpans(line).length &&
			previous.stream === line.stream &&
			previous.page === line.page &&
			Math.abs(previousSpan.x - first.x) < first.fontSize * 0.2 &&
			Math.abs(previousSpan.fontSize - first.fontSize) < 1 &&
			baseline(first) - baseline(previousSpan) > 0 &&
			baseline(first) - baseline(previousSpan) <= first.fontSize * 4 &&
			wrapsInto(previous, first)
		) {
			previous.text += ` ${line.text}`;
			previous.spans = line.spans;
			previous.y = line.y;
			continue;
		}
		lines.push(line);
	}
	return lines;
}

function boundedLines(doc: ExtractedDocument): ImportLine[] | null {
	if (!allowsPdfGeometry(doc)) return null;
	try {
		return importLines(doc);
	} catch (error) {
		if (error instanceof GeometryLimit) return null;
		throw error;
	}
}

export function documentToLines(doc: ExtractedDocument): string[] {
	return (boundedLines(doc) ?? doc.lines).map((line) => line.text);
}

function readIdentity(lines: ImportLine[], doc: ExtractedDocument) {
	const identity = lines.filter((line) => line.identity);
	if (!identity.length) return;
	const fields = identity.flatMap(fieldsOf).flatMap((field) => {
		const spans = field.spans.filter((span) => !standaloneDate(span.text));
		return spans.length ? [lineWithSpans(field, spans)] : [];
	});
	const linked = new Map<string, TextSpan[]>();
	for (const span of fields.flatMap((field) => field.spans)) {
		const target = annotationTarget(doc, span);
		if (!target) continue;
		const spans = linked.get(target) ?? [];
		if (!spans.includes(span)) spans.push(span);
		linked.set(target, spans);
	}
	const contactFields = fields.filter(
		(field) => hasContactDetails(field.text) || field.spans.some((span) => annotationTarget(doc, span)),
	);
	const contactTop = contactFields.reduce((y, line) => Math.min(y, line.y), Infinity);
	const text = fields
		.flatMap((field) => {
			const spans = field.spans.filter((span) => !annotationTarget(doc, span));
			return spans.length ? [lineWithSpans(field, spans)] : [];
		})
		.filter((field) => !isContactLine(field.text));
	const contactX = contactFields.reduce((x, field) => Math.min(x, field.x), Infinity);
	const nameSize = text.reduce((size, field) => Math.max(size, field.fontSize), 0);
	const identityLeft = text
		.filter((field) => Math.abs(field.fontSize - nameSize) < 1)
		.reduce((x, field) => Math.min(x, field.x), Infinity);
	const contactSize = contactFields.reduce((size, field) => Math.max(size, field.fontSize), 0);
	const isInsetContact = (field: TextLine) =>
		!(nameSize > contactSize + 1 && Math.abs(field.fontSize - nameSize) < 1) &&
		contactX > identityLeft + field.fontSize * 0.5 &&
		Math.abs(field.x - contactX) < field.fontSize * 0.25;
	const before = text.filter((field) => field.y < contactTop && !isInsetContact(field));
	const biggest = before.reduce((size, line) => Math.max(size, line.fontSize), 0);
	const names = before.filter((line) => Math.abs(line.fontSize - biggest) < 1);
	const nameRows =
		names.length === before.length && biggest <= Math.max(...contactFields.map((field) => field.fontSize)) + 1
			? names.slice(0, 1)
			: names;
	const name = nameRows.map((line) => line.text).join(" ");
	const headline = before
		.filter((line) => !nameRows.includes(line))
		.map((line) => line.text)
		.join(" ");
	const contact = parseResumeText(identity.map((line) => line.text).join("\n")).basics;
	let email = contact.email;
	let phone = contact.phone;
	let website = contact.website;
	const customFields: { id: string; icon: string; text: string; link: string }[] = [];
	for (const [url, spans] of linked) {
		if (url.startsWith("mailto:")) email = url.slice(7).split("?")[0] ?? email;
		else if (url.startsWith("tel:")) phone = url.slice(4);
		else if (/^https?:\/\//i.test(url)) {
			const label = joinSpans(spans);
			const displayed = /^https?:\/\//i.test(label) && URL.canParse(label) && new URL(label).href === url;
			const sameWebsite =
				URL.canParse(website.url) && URL.canParse(url) && new URL(website.url).href === new URL(url).href;
			if (!website.url || sameWebsite) {
				website = { url: displayed ? label : url, label: displayed ? "" : label };
			} else customFields.push({ id: generateId(), icon: "", text: label, link: url });
		}
	}
	const location = text
		.filter((field) => field.y >= contactTop || isInsetContact(field))
		.map((line) => line.text)
		.join(" ");
	return { name, headline, email, phone, location, website, customFields };
}

function mergeIdentity(basics: ResumeData["basics"], identity: ReturnType<typeof readIdentity>): ResumeData["basics"] {
	if (!identity) return basics;
	return {
		...basics,
		...identity,
		name: identity.name || basics.name,
		email: identity.email || basics.email,
		phone: identity.phone || basics.phone,
		website: identity.website.url ? identity.website : basics.website,
		customFields: identity.customFields.length ? identity.customFields : basics.customFields,
		// Geometry owns headline/location boundaries, including deliberately empty fields.
		// A name below the contact row is not also a location.
		location: !identity.name && identity.location === basics.name ? basics.location : identity.location,
	};
}

function educationCells(row: TextLine) {
	const fields = fieldsOf(row);
	if (fields.length !== 1 || !row.spans[0]) return fields;
	const font = row.spans[0].fontRef;
	const split = row.spans.findIndex((span) => span.fontRef !== font);
	return split > 0
		? [lineWithSpans(row, row.spans.slice(0, split)), lineWithSpans(row, row.spans.slice(split))]
		: fields;
}

/** Decode only corroborated stacked records; every unassigned span stays in the record description. */
function educationRecords(
	source: ImportLine[],
	work: GeometryIndex,
	locale: string,
): ResumeData["sections"]["education"]["items"] | null {
	work.charge(source.reduce((n, row) => n + row.spans.length, 0) * 4);
	const run: ImportLine[] = [];
	for (let index = 0; index < source.length; index++) {
		const row = source[index];
		if (!row) continue;
		const next = source[index + 1];
		const following = source[index + 2];
		const lead = educationCells(row);
		const pair = next ? educationCells(next) : [];
		const below = following ? educationCells(following) : [];
		const school = lead[0];
		const degree = pair[0];
		const area = below[0];
		const tail = below[1];
		// A split row can wrap its right cell below the title while preserving both column edges.
		if (
			next &&
			following &&
			lead.length === 1 &&
			pair.length === 1 &&
			below.length === 2 &&
			school &&
			degree &&
			area &&
			tail &&
			school.fontRef !== degree.fontRef &&
			area.fontRef === degree.fontRef &&
			Math.abs(area.x - school.x) < school.fontSize * 0.25 &&
			degree.x > school.x + school.fontSize &&
			Math.abs(degree.x + degree.width - tail.x - tail.width) < school.fontSize * 0.25 &&
			row.page === following.page &&
			row.stream === following.stream
		) {
			run.push({ ...row, ...lineWithSpans(row, [...row.spans, ...next.spans]) });
			index++;
		} else run.push(row);
	}
	const rows = run.map(educationCells);
	const first = rows[0]?.[0];
	if (!first) return null;
	const isLead = (index: number) => {
		const row = rows[index];
		const next = rows[index + 1];
		const lead = row?.[0];
		const pair = row?.[1];
		const area = next?.[0];
		const tail = next?.[1];
		return Boolean(
			lead &&
			pair &&
			area &&
			tail &&
			row?.length === 2 &&
			next?.length === 2 &&
			Math.abs(lead.x - first.x) < lead.fontSize * 0.25 &&
			lead.fontRef === first.fontRef &&
			lead.fontRef !== pair.fontRef &&
			Math.abs(area.x - lead.x) < lead.fontSize * 0.25 &&
			area.fontRef !== lead.fontRef &&
			pair.x > lead.x + lead.fontSize &&
			tail.x > area.x + area.fontSize &&
			Math.abs(pair.x + pair.width - tail.x - tail.width) < lead.fontSize * 0.25 &&
			run[index]?.page === run[index + 1]?.page &&
			run[index]?.stream === run[index + 1]?.stream,
		);
	};
	if (!isLead(0)) return null;
	if (
		rows.some((row, index) => {
			const lead = row[0];
			const pair = row[1];
			return (
				lead &&
				pair &&
				Math.abs(lead.x - first.x) < lead.fontSize * 0.25 &&
				lead.fontRef === first.fontRef &&
				lead.fontRef !== pair.fontRef &&
				!isLead(index)
			);
		})
	)
		return null;
	const starts = run.flatMap((_, index) => (isLead(index) ? [index] : []));
	const items: ResumeData["sections"]["education"]["items"] = [];
	for (const [record, start] of starts.entries()) {
		const end = starts[record + 1] ?? run.length;
		const lead = rows[start]?.[0];
		const pair = rows[start]?.[1];
		const area = rows[start + 1]?.[0];
		const tail = rows[start + 1]?.[1];
		if (!lead || !pair || !area || !tail) return null;
		const parts = pair.text.split(/\s+•\s+/);
		const locationParts = tail.text.split(/\s+•\s+/);
		const last = locationParts.at(-1) ?? "";
		const period = standaloneDate(last);
		if (period) locationParts.pop();
		const assigned = new Set([...lead.spans, ...pair.spans, ...area.spans, ...tail.spans]);
		const residual = run.slice(start, end).flatMap((row) => {
			const spans = row.spans.filter((span) => !assigned.has(span));
			return spans.length ? [joinSpans(spans)] : [];
		});
		work.charge(run.slice(start, end).reduce((n, row) => n + row.spans.length, 0));
		items.push({
			id: generateId(),
			hidden: false,
			school: lead.text,
			degree: parts[0] ?? "",
			grade: parts.slice(1).join(" • "),
			area: area.text,
			location: locationParts.join(" • "),
			period,
			dates: readLegacyDates(period, { locale, single: !findPeriod(period) }),
			website: { url: "", label: "", inlineLink: false },
			description: toHtmlBlocks(residual),
		});
	}
	return items;
}

/** Match records within their section stream, so links and split header cells cannot escape into prose. */
function projectSectionFields(data: ResumeData, lines: ImportLine[], doc: ExtractedDocument): ResumeData {
	const work = new GeometryIndex(lines);
	const education: ResumeData["sections"]["education"]["items"] = [];
	let hasEducation = false;
	for (let start = 0; start < lines.length; start++) {
		const heading = lines[start];
		if (!heading?.heading) continue;
		const key = knownHeading(heading.text);
		if (!key || key === "summary") continue;
		let end = start + 1;
		while (end < lines.length && !lines[end]?.heading) end++;
		const run = lines.slice(start + 1, end);
		const section =
			key === "education"
				? {
						...data.sections.education,
						items:
							educationRecords(run, work, data.metadata.page.locale) ??
							parseResumeText([heading.text, ...run.map((line) => line.text)].join("\n"), new Set([0])).sections
								.education.items,
					}
				: data.sections[key];
		if (key === "education") {
			// Parse and project this run before merging: repeated or mentioned schools cannot claim another run's items.
			hasEducation = true;
			education.push(...(section.items as ResumeData["sections"]["education"]["items"]));
		}
		let cursor = 0;
		const items = section.items as unknown as Record<string, unknown>[];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const item = items[itemIndex];
			if (!item) continue;
			const title = ["company", "school", "organization", "title", "name", "network"]
				.map((field) => item[field])
				.find((value) => typeof value === "string" && value);
			if (typeof title !== "string") continue;
			const matches = (line: ImportLine, value: string) => {
				if (line.record?.company === value || fieldsOf(line).some((field) => field.text === value)) return true;
				if (key !== "education") return false;
				work.charge(line.spans.length);
				return educationCells(line).some((field) => field.text === value);
			};
			work.charge(run.length * 3);
			const relative = run.slice(cursor).findIndex((line) => matches(line, title));
			if (relative < 0) continue;
			const begin = cursor + relative;
			const next = items[itemIndex + 1];
			const nextTitle =
				next &&
				["company", "school", "organization", "title", "name", "network"]
					.map((field) => next[field])
					.find((value) => typeof value === "string" && value);
			const offset =
				typeof nextTitle === "string" ? run.slice(begin + 1).findIndex((line) => matches(line, nextTitle)) : -1;
			const finish = offset >= 0 ? begin + 1 + offset : run.length;
			cursor = finish;
			const chunk = run.slice(begin, finish);
			const headerFields = Object.entries(item)
				.flatMap(([field, value]) =>
					field !== "id" && field !== "description" && typeof value === "string" && value ? [value] : [],
				)
				.sort((a, b) => b.length - a.length);
			const bodyStart = chunk.findIndex((line) => {
				work.charge(line.text.length * headerFields.length);
				const rest = headerFields.reduce((text, field) => text.replaceAll(field, ""), line.text);
				return Boolean(rest.replace(/[\s•·|,;:()–—-]/g, ""));
			});
			const header = chunk.slice(0, bodyStart < 0 ? chunk.length : bodyStart);
			const linked = chunk
				.flatMap(fieldsOf)
				.filter(
					(line) =>
						line.spans.length &&
						line.spans.every((span) => /^https?:\/\//i.test(annotationTarget(doc, span) ?? "")) &&
						new Set(line.spans.map((span) => annotationTarget(doc, span))).size === 1,
				)
				.map((line) => {
					work.charge(line.spans.length);
					return lineWithSpans(line, line.spans);
				});
			const headerLinks = linked.filter((field) =>
				header.some((line) => field.spans.some((span) => line.spans.includes(span))),
			);
			const right = Math.max(...chunk.flatMap((line) => line.spans.map((span) => span.x + span.width)));
			// A block link box spans its column; ordinary prose links only cover their printed text.
			const footer = linked.find((line) => {
				const span = line.spans[0];
				if (!span) return false;
				const links = doc.links ?? [];
				const height = doc.pages.find((page) => page.pageNumber === line.page)?.height ?? 0;
				work.charge(links.length + doc.pages.length);
				return links.some(
					(link) =>
						link.page === line.page &&
						link.url === annotationTarget(doc, span) &&
						line.y < height - Math.min(link.rect[1], link.rect[3]) &&
						line.y + line.height > height - Math.max(link.rect[1], link.rect[3]) &&
						Math.max(link.rect[0], link.rect[2]) >= right - line.fontSize &&
						Math.abs(link.rect[2] - link.rect[0]) > line.width + line.fontSize * 2,
				);
			});
			// shortcut: an untagged full-column prose link can resemble a footer field; tagged PDFs would remove this ambiguity.
			// Other body links, including a leading linked paragraph, stay description prose.
			const slot = headerLinks.find((line) => line.text === title) ?? footer ?? headerLinks.at(-1);
			const linkedSpan = slot?.spans[0];
			if (slot && linkedSpan && "website" in item) {
				const url = annotationTarget(doc, linkedSpan) ?? "";
				const label = slot.text;
				const displayed = URL.canParse(label) && new URL(label).href === url;
				item.website = { url: displayed ? label : url, label: displayed ? "" : label, inlineLink: false };
				if (typeof item.description === "string") {
					const block = toHtmlBlocks([slot.text]);
					if (slot === footer) {
						// A reordered website block can precede the description.
						if (chunk[bodyStart]?.spans.some((span) => slot.spans.includes(span)) && item.description.startsWith(block))
							item.description = item.description.slice(block.length);
						else if (item.description.endsWith(block)) item.description = item.description.slice(0, -block.length);
						else {
							// A wrapped last paragraph can share its logical line with the footer link.
							const suffix = ` ${escapeHtml(label)}</p>`;
							if (item.description.endsWith(suffix))
								item.description = item.description.slice(0, -suffix.length) + "</p>";
						}
					}
				}
			}
		}
		start = end - 1;
	}
	if (hasEducation) data.sections.education.items = education;
	return data;
}

/** shortcut: dense/expensive geometry retains complete text in Summary; exact field mapping needs tagged PDF evidence. */
function flatPdfResume(doc: ExtractedDocument) {
	const flat = parseResumeText(doc.fullText);
	flat.summary.content = toHtmlBlocks(doc.lines.map((line) => line.text));
	return parseResumeData(flat);
}

export function parsePdfResume(doc: ExtractedDocument) {
	try {
		return parseGeometryResume(doc);
	} catch (error) {
		if (error instanceof GeometryLimit) return flatPdfResume(doc);
		throw error;
	}
}

function parseGeometryResume(doc: ExtractedDocument) {
	const lines = boundedLines(doc);
	if (!lines) return flatPdfResume(doc);
	// Without any geometry heading every line would be filed as header, keeping only contacts. Keep the prose instead:
	// lines outside the identity block with a field that is neither a contact item nor a link.
	const prose = lines.filter(
		(line) =>
			!line.identity &&
			fieldsOf(line).some(
				(field) => !isContactLine(field.text) && !field.spans.every((span) => annotationTarget(doc, span)),
			),
	);
	if (!lines.some((line) => line.heading) && prose.length) {
		const flat = flatPdfResume(doc);
		flat.summary.content = toHtmlBlocks(prose.map((line) => line.text));
		// Geometry identity is the owner; the text parse only fills fields it left empty.
		return parseResumeData({ ...flat, basics: mergeIdentity(flat.basics, readIdentity(lines, doc)) });
	}

	const parsed = parseResumeText(
		lines.map((line) => line.text).join("\n"),
		new Set(lines.flatMap((line, index) => (line.heading ? [index] : []))),
	);
	const firstSection = lines.findIndex((line) => line.heading);
	const name = lines.find(
		(line) => line.identity && !isContactLine(line.text) && line.fontSize > (doc.modalFontSize ?? line.fontSize),
	);
	if (name && firstSection > 0) {
		const introduction = lines.slice(0, firstSection).filter((line) => !line.identity && !isContactLine(line.text));
		if (introduction.length)
			parsed.summary.content = toHtmlBlocks(introduction.map((line) => line.text)) + parsed.summary.content;
	}
	parsed.basics = mergeIdentity(parsed.basics, readIdentity(lines, doc));
	const records: { header: RecordHeader; body: string[] }[] = [];
	let active: (typeof records)[number] | undefined;
	for (const line of lines) {
		if (line.heading) active = undefined;
		if (line.record) {
			active = { header: line.record, body: [] };
			records.push(active);
		} else if (active && !line.recordDate) active.body.push(line.text);
	}
	if (
		!records.length ||
		records.length < parsed.sections.experience.items.length ||
		(records.length !== parsed.sections.experience.items.length &&
			parsed.sections.experience.items.some(
				(item) =>
					!records.some((record) => record.header.company === item.company && record.header.position === item.position),
			))
	)
		return parseResumeData(projectSectionFields(parsed, lines, doc));
	return parseResumeData(
		projectSectionFields(
			{
				...parsed,
				sections: {
					...parsed.sections,
					experience: {
						...parsed.sections.experience,
						items: records.map(({ header, body }, index) => ({
							id: generateId(),
							hidden: false,
							website: { url: "", label: "", inlineLink: false },
							roles: [],
							...parsed.sections.experience.items[index],
							...header,
							dates: readLegacyDates(header.period, { locale: parsed.metadata.page.locale, single: false }),
							description: toHtmlBlocks(body),
						})),
					},
				},
			},
			lines,
			doc,
		),
	);
}
