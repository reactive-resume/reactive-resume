/**
 * Batch items keep the wire casing of their header names, so an item may spell the binding `X-Account-Id`. Read it
 * through the platform's case-insensitive Headers view instead of matching a raw JSON key: `X-Account-Id` and
 * `x-account-id` are the same binding, duplicate values collapse when they agree, and conflicting duplicates stay a
 * value that cannot match an account id (the every-known-binding check then fails closed). Only this header is read
 * here; cookies and tokens never contribute to the binding.
 */
export function readAccountBinding(headers: Record<string, string | string[] | undefined>) {
	const view = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		for (const entry of Array.isArray(value) ? value : [value]) {
			try {
				view.append(name, entry);
			} catch {
				// Ignore malformed header names; they cannot be the account binding.
			}
		}
	}
	const raw = view.get("x-account-id");
	if (raw === null) return undefined;
	const values = raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const [first] = values;
	if (!first) return undefined;
	return values.every((value) => value === first) ? first : raw;
}
