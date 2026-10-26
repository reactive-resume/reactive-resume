import { z } from "zod";

/** Slugs cannot exceed 64 characters. */
export const MAX_SLUG_LENGTH = 64;

/** Format: lowercase letters and numbers, separated by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether a slug string is valid according to length and character pattern rules. */
export function isValidSlug(slug: string): boolean {
	return slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}

/** Lowercases and replaces whitespace sequences with single dashes for live input. */
export function normalizeSlug(slug: string): string {
	return slug.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Zod schema for validated slug length and trimming at API boundary.
 *
 * Pattern validation is intentionally deferred to service layer (`isValidSlug`)
 * so clients receive a typed `INVALID_SLUG` domain error instead of generic `BAD_REQUEST`.
 */
export const slugSchema = z.string().trim().min(1).max(MAX_SLUG_LENGTH).describe("The slug of the resume.");
