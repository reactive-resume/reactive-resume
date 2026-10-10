export function getTrustedOrigins(appUrl: string): string[] {
	const trustedOrigins = new Set<string>();

	if (process.env.NODE_ENV !== "production") {
		trustedOrigins.add("http://localhost:3000");
		trustedOrigins.add("http://127.0.0.1:3000");
	}

	const configuredUrl = new URL(appUrl);
	trustedOrigins.add(configuredUrl.origin);

	if (configuredUrl.hostname === "localhost" || configuredUrl.hostname === "127.0.0.1") {
		const loopbackAlias = configuredUrl.hostname === "localhost" ? "127.0.0.1" : "localhost";
		configuredUrl.hostname = loopbackAlias;
		trustedOrigins.add(configuredUrl.origin);
	}

	return [...trustedOrigins];
}
