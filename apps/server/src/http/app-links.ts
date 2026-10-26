import { env } from "@reactive-resume/env/server";

export function handleAppleAppSiteAssociation() {
	if (!env.MOBILE_IOS_APP_IDS.length) return new Response(null, { status: 404 });
	return Response.json({
		applinks: {
			apps: [],
			details: env.MOBILE_IOS_APP_IDS.map((appID) => ({
				appID,
				paths: [
					"/auth/native-callback",
					"/builder/*",
					"NOT /auth/*",
					"NOT /api/*",
					"NOT /mcp/*",
					"NOT /uploads/*",
					"NOT /dashboard/*",
					"NOT /.well-known/*",
					"NOT /templates/*",
					"NOT /agent/*",
				],
			})),
		},
		webcredentials: { apps: env.MOBILE_IOS_APP_IDS },
	});
}

export function handleAndroidAssetLinks() {
	if (!env.MOBILE_ANDROID_PACKAGES.length || !env.MOBILE_ANDROID_CERT_SHA256.length)
		return new Response(null, { status: 404 });
	return Response.json(
		env.MOBILE_ANDROID_PACKAGES.map((packageName) => ({
			relation: ["delegate_permission/common.handle_all_urls"],
			target: {
				namespace: "android_app",
				package_name: packageName,
				sha256_cert_fingerprints: env.MOBILE_ANDROID_CERT_SHA256,
			},
		})),
	);
}
