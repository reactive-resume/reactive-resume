import { count } from "drizzle-orm";
import z from "zod";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
const GITHUB_API_URL = "https://api.github.com/repos/reactive-resume/reactive-resume";
const GITHUB_REQUEST_TIMEOUT_MS = 5_000;
const GITHUB_REQUEST_MAX_ATTEMPTS = 2;

const LAST_KNOWN = {
	users: 1_213_116,
	resumes: 1_651_895,
	stars: 42_315,
} as const;

// ponytail: file-based disk cache replaced with module-level memo; LAST_KNOWN fallbacks cover restarts
const memCache = new Map<string, { value: number; cachedAt: number }>();

const getCached = (key: string) => {
	const entry = memCache.get(key);
	if (!entry || Date.now() - entry.cachedAt >= CACHE_DURATION_MS) return null;
	return entry;
};

const setCached = (key: string, value: number) => {
	memCache.set(key, { value, cachedAt: Date.now() });
};

const getCachedCount = async (
	key: string,
	lastKnown: number,
	fetcher: () => Promise<number | null>,
): Promise<number> => {
	const cached = getCached(key);
	if (cached !== null) return cached.value;

	try {
		const value = await fetcher();
		if (value !== null) {
			setCached(key, value);
			return value;
		}
	} catch {
		// Ignore errors, use last known value
	}

	return lastKnown;
};

const getCountFromDatabase = async (table: typeof schema.user | typeof schema.resume): Promise<number | null> => {
	const [result] = await db.select({ count: count() }).from(table);
	return result?.count ?? null;
};

const fetchGitHubStarsOnce = async (): Promise<number | null> => {
	try {
		const response = await fetch(GITHUB_API_URL, {
			signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
			headers: {
				Accept: "application/vnd.github+json",
			},
		});
		if (!response.ok) return null;

		const data = z.object({ stargazers_count: z.number().int().nonnegative() }).safeParse(await response.json());
		return data.success ? data.data.stargazers_count : null;
	} catch {
		return null;
	}
};

const getGitHubStars = async (attempt = 1): Promise<number | null> => {
	if (attempt > GITHUB_REQUEST_MAX_ATTEMPTS) return null;

	const stars = await fetchGitHubStarsOnce();
	return stars ?? getGitHubStars(attempt + 1);
};

export const statisticsService = {
	getTotals: async () => {
		const [users, resumes] = await Promise.all([
			statisticsService.user.getCount(),
			statisticsService.resume.getCount(),
		]);
		const usersCache = getCached("users");
		const resumesCache = getCached("resumes");

		return {
			users,
			resumes,
			// Use the older count's timestamp so the pair never looks fresher than either total.
			cachedAt:
				usersCache?.value === users && resumesCache?.value === resumes
					? Math.min(usersCache.cachedAt, resumesCache.cachedAt)
					: null,
		};
	},
	user: {
		getCount: () => {
			return getCachedCount("users", LAST_KNOWN.users, () => getCountFromDatabase(schema.user));
		},
	},
	resume: {
		getCount: () => {
			return getCachedCount("resumes", LAST_KNOWN.resumes, () => getCountFromDatabase(schema.resume));
		},
	},
	github: {
		getStarCount: () => {
			return getCachedCount("stars", LAST_KNOWN.stars, getGitHubStars);
		},
	},
};
