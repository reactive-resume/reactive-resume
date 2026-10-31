export function canonicalOpportunityUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			!host.includes(".") ||
			/^[\d.]+$/.test(host) ||
			/(?:^|\.)(localhost|local|internal|lan)$/.test(host) ||
			host.endsWith(".home.arpa")
		)
			return null;
		url.hash = "";
		// A LinkedIn posting's query only tracks the click (refId, trackingId, position, pageNum, trk).
		if (/(?:^|\.)linkedin\.com$/.test(host) && url.pathname.startsWith("/jobs/view/")) url.search = "";
		const trackingKeys = Array.from(url.searchParams.keys()).filter((key) =>
			/^(?:utm_|fbclid$|gclid$|msclkid$|gh_src$|trk$|refid$|trackingid$|source$|ref$|referrer$|token$|access_token$|auth$|authorization$|session$|sessionid$|session_id$|password$|key$|api_key$|signature$|expires$)/i.test(
				key,
			),
		);
		for (const key of trackingKeys) url.searchParams.delete(key);
		url.searchParams.sort();
		return url.toString();
	} catch {
		return null;
	}
}
