// A4's request, read from the deep link's OAuth query (client_id, scope, redirect_uri, sig, …) as the web consent page
// reads it. Anyone can register a client under any name, so the screen shows where access is sent (the redirect host).
export type ConsentRequest = {
	clientName: string;
	destination: string;
	scopes: Set<string>;
	/** The signed query, passed on unchanged to the server's consent page. */
	query: string;
};

export function redirectDestination(redirectUri: string | undefined): string | null {
	if (!redirectUri) return null;
	try {
		const url = new URL(redirectUri);
		if (url.protocol === "http:" || url.protocol === "https:") return url.host;
		// A custom scheme can be claimed by any app, so keep the scheme: a site's host never ends in ":".
		return url.host ? `${url.protocol}//${url.host}` : url.protocol;
	} catch {
		return null;
	}
}

export function parseConsentRequest(params: Record<string, string | undefined>, fake: boolean): ConsentRequest | null {
	const entries = Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string");
	const query = new URLSearchParams(entries).toString();
	const clientId = params.client_id;
	if (!clientId || !params.sig) {
		if (!fake) return null;
		// The storyboard's request: Claude asking for the full API.
		return {
			clientName: "Claude",
			destination: "claude.ai",
			scopes: new Set(["openid", "profile", "email", "api:read", "api:write", "api:delete"]),
			query,
		};
	}
	const destination = redirectDestination(params.redirect_uri);
	if (!destination) return null;
	return {
		// The query's own name is unverified (the web page asks the server for it), so name the destination instead.
		clientName: destination,
		destination,
		scopes: new Set((params.scope ?? "").split(" ").filter(Boolean)),
		query,
	};
}
