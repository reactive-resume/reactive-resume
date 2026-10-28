import { eq } from "drizzle-orm";
import z from "zod";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { cvDomainFor } from "@reactive-resume/resume/sharing";
import { isCustomDomainsEnabled } from "./service";

const CHECK_URL = "https://ola.cv/api/v1/domains/check";
// Availability changes only when someone registers a name, so a check is reused for a while and shared by accounts.
const CACHE_MS = 15 * 60_000;
const CACHE_LIMIT = 5_000;

const checkResponse = z.object({
	data: z.record(
		z.string(),
		z.object({
			available: z.boolean(),
			premium: z.boolean().optional(),
			registration_fee: z.coerce.number().optional(),
			renewal_fee: z.coerce.number().optional(),
			currency: z.string().optional(),
		}),
	),
});

/** What registering costs; `renewal` is each later year, when OlaCV says. */
type Price = { amount: number; renewal: number | null; currency: string };
type Check = { available: boolean; premium: boolean; price: Price | null };

const cache = new Map<string, { check: Check; expires: number }>();

export type CvDomainSuggestion = {
	domain: string;
	/** OlaCV confirmed it's free to register. False when it couldn't be checked, so it only may be. */
	checked: boolean;
	price: Price | null;
};

/** The `.cv` names worth suggesting for an account, best first: its username, then its name joined and hyphenated. */
function cvCandidates(user: { username: string; name: string }): string[] {
	const words = user.name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const names = [user.username, words.join(""), words.join("-")].map(cvDomainFor);
	return [...new Set(names.filter((name): name is string => Boolean(name)))];
}

/** Asks OlaCV about the names not checked recently. `null` when OlaCV can't be reached or answers unexpectedly. */
async function checkDomains(domains: string[], token: string): Promise<Map<string, Check> | null> {
	const now = Date.now();
	const result = new Map<string, Check>();
	for (const domain of domains) {
		const hit = cache.get(domain);
		if (hit && hit.expires > now) result.set(domain, hit.check);
	}
	const missing = domains.filter((domain) => !result.has(domain));
	if (missing.length === 0) return result;

	try {
		const response = await fetch(CHECK_URL, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: JSON.stringify({ domains: missing }),
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) return null;
		const parsed = checkResponse.safeParse(await response.json());
		if (!parsed.success) return null;

		if (cache.size >= CACHE_LIMIT) cache.clear();
		for (const domain of missing) {
			const entry = parsed.data.data[domain];
			const check: Check = {
				available: entry?.available ?? false,
				premium: entry?.premium ?? false,
				price:
					entry?.registration_fee !== undefined && entry.currency
						? { amount: entry.registration_fee, renewal: entry.renewal_fee ?? null, currency: entry.currency }
						: null,
			};
			cache.set(domain, { check, expires: now + CACHE_MS });
			result.set(domain, check);
		}
		return result;
	} catch {
		return null;
	}
}

/**
 * A `.cv` domain to suggest in Share: the first of the account's names that OlaCV says is free and not premium. Without
 * an API key, or when OlaCV doesn't answer, the username's name is suggested unchecked. `null` when nothing fits.
 */
export async function suggestCvDomain(userId: string): Promise<CvDomainSuggestion | null> {
	if (!env.FLAG_OLACV_SUGGESTION || !isCustomDomainsEnabled()) return null;
	const [user] = await db
		.select({ username: schema.user.username, name: schema.user.name })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	const candidates = user ? cvCandidates(user) : [];
	const first = candidates[0];
	if (!first) return null;

	const checks = env.OLACV_API_KEY ? await checkDomains(candidates, env.OLACV_API_KEY) : null;
	if (!checks) return { domain: first, checked: false, price: null };

	for (const domain of candidates) {
		const check = checks.get(domain);
		if (check?.available && !check.premium) return { domain, checked: true, price: check.price };
	}
	return null;
}
