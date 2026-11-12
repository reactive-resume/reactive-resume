import { resolve } from "node:path";
import { ciEnv, databaseUrl, root } from "../dev/test-db.mjs";

// One place for the Calm capture setup: where the redesign bundle's working folder is, which ports and database the
// standing dev server uses, and the instant every capture is frozen at. Nothing here is secret (ciEnv is public).
export { root };
export const work = process.env.CALM_WORK ?? resolve(root, "../Reactive-Resume/.agents/handoff/web-redesign/work");

// The standing server is the default. To try the seed elsewhere, set CALM_DB (a name starting with rr_calm_) and
// CALM_PORT (web port; the API and AI stub take the next two); its state then lives in <work>/state-<CALM_DB> unless
// CALM_STATE says otherwise. CALM_API_ONLY=1 starts no Vite: the API answers /api on its own port.
export const database = process.env.CALM_DB ?? "rr_calm_capture";
if (!database.startsWith("rr_calm_")) throw new Error(`CALM_DB must start with rr_calm_, not ${database}.`);
export const state =
	process.env.CALM_STATE ?? resolve(work, database === "rr_calm_capture" ? "state" : `state-${database}`);

const base = Number(process.env.CALM_PORT ?? 3410);
export const ports = { web: base, server: base + 1, ai: base + 2 };
export const apiOnly = process.env.CALM_API_ONLY === "1";
export const appUrl = `http://localhost:${apiOnly ? ports.server : ports.web}`;
export const aiBaseUrl = `http://127.0.0.1:${ports.ai}/v1`;
/** Saturday 7 November 2026, 09:00 in Lisbon (UTC+0 in November). */
export const now = "2026-11-07T09:00:00.000Z";
export const timezone = "Europe/Lisbon";

export const env = {
	...ciEnv,
	APP_URL: appUrl,
	PORT: String(ports.web),
	SERVER_PORT: String(ports.server),
	DATABASE_URL: databaseUrl(database),
	STORAGE_BACKEND: "local",
	LOCAL_STORAGE_PATH: resolve(state, "storage"),
	CALM_NOW: now,
	// Custom domains on, so Share draws "Short link and domain" (B5, B28). The seeded domain publishes no matching
	// records, so it stays "not connected yet". Not secrets: the provider secret only guards the Traefik route.
	CUSTOM_DOMAIN_TARGET: "domains.rxresu.me",
	CUSTOM_DOMAIN_PROVIDER_SECRET: "calm-capture-traefik-provider-secret",
};

export const healthy = () =>
	fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(5000) }).then(
		(response) => response.ok,
		() => false,
	);
