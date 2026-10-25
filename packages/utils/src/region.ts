import z from "zod";
import { ZONE_COUNTRY } from "./region-zones";

const COUNTRY_CODES: ReadonlySet<string> = new Set(Object.values(ZONE_COUNTRY));

/** An uppercase ISO 3166-1 alpha-2 code for a country that has an IANA time zone, such as "DE". */
export const countryCodeSchema = z
	.string()
	.regex(/^[A-Z]{2}$/)
	.refine((code) => COUNTRY_CODES.has(code), "Choose a valid country.");

/** Up to three distinct countries a user's web searches should target. */
export const searchRegionsSchema = z
	.array(countryCodeSchema)
	.max(3)
	.refine((codes) => new Set(codes).size === codes.length, "Remove duplicate countries.")
	.nullable()
	.optional();

/** The country an IANA time zone belongs to, or null for UTC, Etc/* and unknown names. */
export function countryForTimeZone(timeZone: string): string | null {
	return Object.hasOwn(ZONE_COUNTRY, timeZone) ? (ZONE_COUNTRY[timeZone] ?? null) : null;
}

/** The localized country name for a code, falling back to the code itself. */
export function countryName(code: string, locale: string): string {
	try {
		return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/** The most countries a user can search at once; each is its own provider call. */
export const MAX_SEARCH_REGIONS = 3;

/** Every code `countryCodeSchema` accepts, sorted, for country pickers. */
export const SEARCH_REGION_CODES: readonly string[] = [...COUNTRY_CODES].sort();

/** What a search-regions picker shows: its chips and whether they come from a time zone. */
export type ShownSearchRegions = { codes: string[]; automatic: boolean };

/**
 * The chips follow explicit choices or the account time zone. Only an untouched UTC account shows the device
 * country, which the server adopts before its first search or discovery schedule.
 */
export function shownSearchRegions(
	value: readonly string[] | null | undefined,
	accountTimeZone: string | null | undefined,
	deviceTimeZone: string | null | undefined,
): ShownSearchRegions {
	if (value) return { codes: [...value], automatic: false };
	if (value === null || (accountTimeZone && accountTimeZone !== "UTC")) {
		const code = accountTimeZone ? countryForTimeZone(accountTimeZone) : null;
		return { codes: code ? [code] : [], automatic: true };
	}
	const device = deviceTimeZone ? countryForTimeZone(deviceTimeZone) : null;
	return { codes: device ? [device] : [], automatic: true };
}

/** A picker action on the shown chips: add a country, remove one, or return to automatic. */
export type SearchRegionsAction =
	| { type: "add"; code: string }
	| { type: "remove"; code: string }
	| { type: "automatic" };

/** The `searchRegions` value to save after an action; returns `shown` itself when the action changes nothing. */
export function nextSearchRegions(shown: string[], action: SearchRegionsAction): string[] | null {
	switch (action.type) {
		case "automatic":
			return null;
		case "add":
			if (shown.length >= MAX_SEARCH_REGIONS || shown.includes(action.code)) return shown;
			return countryCodeSchema.safeParse(action.code).success ? [...shown, action.code] : shown;
		case "remove":
			return shown.includes(action.code) ? shown.filter((code) => code !== action.code) : shown;
	}
}
