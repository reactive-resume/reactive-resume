// Kept apart from ./string.ts: the transliteration tables and name lists are large, and most pages need neither.
import _slugify from "@sindresorhus/slugify";
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";

/** Slugifies a string, with some pre-defined options.
 *
 * @param value - The value to slugify.
 * @returns The slugified value.
 */
export function slugify(value: string) {
	const slug = _slugify(value, { decamelize: false });
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
