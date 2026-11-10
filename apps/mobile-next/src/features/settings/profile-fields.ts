// S4's five drawn fields over the application profile's data (given and family name, address, links).
import { applicationProfileDataSchema } from "@reactive-resume/schema/application-profile";

export type ProfileData = ReturnType<typeof applicationProfileDataSchema.parse>;
export type ProfileFields = { name: string; email: string; phone: string; city: string; linkedIn: string };

export const emptyProfile = (): ProfileData => applicationProfileDataSchema.parse({});

const isLinkedIn = (link: { label: string; url: string }) =>
	/linkedin/i.test(link.label) || /linkedin\.com/i.test(link.url);

function countryName(code: string | null, locale: string): string {
	if (!code) return "";
	try {
		return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? "";
	} catch {
		return "";
	}
}

export function toFields(data: ProfileData, locale: string): ProfileFields {
	const country = countryName(data.address.countryCode, locale);
	return {
		name: [data.givenName, data.familyName].filter(Boolean).join(" "),
		email: data.email,
		phone: data.phone,
		city: [data.address.city, country].filter(Boolean).join(", "),
		linkedIn: (data.links.find(isLinkedIn)?.url ?? "").replace(/^https?:\/\//, ""),
	};
}

/**
 * Writes the fields back. The full name splits at its first space (given, then family). The city keeps the text
 * before the first comma; the country stays as saved (it is chosen, not typed). An empty LinkedIn removes the link.
 */
export function fromFields(base: ProfileData, fields: ProfileFields): ProfileData {
	const name = fields.name.trim();
	const space = name.indexOf(" ");
	const links = base.links.filter((link) => !isLinkedIn(link));
	const linkedIn = fields.linkedIn.trim();
	if (linkedIn)
		links.unshift({ label: "LinkedIn", url: /^https?:\/\//i.test(linkedIn) ? linkedIn : `https://${linkedIn}` });
	return {
		...base,
		givenName: space === -1 ? name : name.slice(0, space),
		familyName: space === -1 ? "" : name.slice(space + 1).trim(),
		email: fields.email.trim(),
		phone: fields.phone.trim(),
		address: { ...base.address, city: (fields.city.split(",")[0] ?? "").trim() },
		links,
	};
}
