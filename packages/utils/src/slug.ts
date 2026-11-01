// Kept apart from ./string.ts: the transliteration tables and name lists are large, and most pages need neither.
import _slugify from "@sindresorhus/slugify";
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";

/** Slugifies a string without a random fallback, for address stems that must stay neutral. */
export function slugifyStem(value: string) {
	return _slugify(value, { decamelize: false });
}

/** Slugifies a string, with some pre-defined options.
 *
 * @param value - The value to slugify.
 * @returns The slugified value, or a random name when non-blank text has no writable characters.
 */
export function slugify(value: string) {
	const slug = slugifyStem(value);
	if (slug || !value.trim()) return slug;
	return slugify(generateRandomName());
}

/**
 * Generates a random name using the unique-names-generator library.
 * @returns The random name.
 */
export function generateRandomName() {
	return uniqueNamesGenerator({
		dictionaries: [adjectives, colors, animals],
		style: "capital",
		separator: " ",
		length: 3,
	});
}
