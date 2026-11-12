import { resolve } from "node:path";
import { ciEnv, databaseUrl, root } from "../dev/test-db.mjs";

// One place for the Calm capture setup: where the redesign bundle's working folder is, which ports and database the
// standing dev server uses, and the instant every capture is frozen at. Nothing here is secret (ciEnv is public).
export { root };
export const work = process.env.CALM_WORK ?? resolve(root, "../Reactive-Resume/.agents/handoff/web-redesign/work");
export const state = resolve(work, "state");

export const ports = { web: 3410, server: 3411, ai: 3412 };
export const appUrl = `http://localhost:${ports.web}`;
export const aiBaseUrl = `http://127.0.0.1:${ports.ai}/v1`;
export const database = "rr_calm_capture";
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
};

export const healthy = () =>
	fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(5000) }).then(
		(response) => response.ok,
		() => false,
	);
