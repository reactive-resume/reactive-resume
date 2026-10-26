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

/** Keep boundary parsing structural so the service returns INVALID_SLUG and accepts unchanged legacy addresses. */
export const slugSchema = z.string().trim().describe("The slug of the resume.");
