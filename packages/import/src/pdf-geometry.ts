import type { ExtractedDocument } from "@reactive-resume/resume/ats-pdf";

type Line = ExtractedDocument["lines"][number];

export class GeometryLimit extends Error {}

/** Counts candidate visits, not elapsed time: synchronous work cannot be interrupted by an abort timer. */
export class GeometryIndex {
	private readonly pages = new Map<number, Line[]>();
	get visits() {
		return this.budget.visits;
	}

	constructor(
		readonly fields: readonly Line[],
		readonly budget = { remaining: 400_000, visits: 0 },
	) {
		for (const field of fields) {
			const page = this.pages.get(field.page) ?? [];
			page.push(field);
			this.pages.set(field.page, page);
		}
		for (const page of this.pages.values()) page.sort((a, b) => a.y - b.y || a.x - b.x);
	}

	charge(visits: number) {
		this.budget.remaining -= visits;
		this.budget.visits += visits;
		if (this.budget.remaining < 0) throw new GeometryLimit(`candidate visits: ${this.budget.visits}`);
	}
	private take<T>(values: readonly T[]): readonly T[] {
		this.charge(values.length);
		return values;
	}

	all() {
		return this.take(this.fields);
	}

	page(number: number) {
		return this.take(this.pages.get(number) ?? []);
	}

	near(line: Line, before: number, after: number) {
		const page = this.pages.get(line.page) ?? [];
		const lower = (y: number) => {
			let left = 0;
			let right = page.length;
			while (left < right) {
				const middle = (left + right) >>> 1;
				if ((page[middle]?.y ?? Infinity) < y) left = middle + 1;
				else right = middle;
			}
			return left;
		};
		return this.take(page.slice(lower(line.y - before), lower(line.y + after + 0.001)));
	}
}

/** Bound preprocessing too, before any pairwise layout or annotation matching. */
export function allowsPdfGeometry(doc: ExtractedDocument): boolean {
	let pairs = 0;
	const links = new Map<number, number>();
	for (const link of doc.links ?? []) links.set(link.page, (links.get(link.page) ?? 0) + 1);
	for (const page of doc.pages) {
		const count = page.lines.reduce((n, line) => n + line.spans.length, 0) + (links.get(page.pageNumber) ?? 0);
		pairs += count * count;
		if (pairs > 1_000_000) return false;
	}
	return true;
}
