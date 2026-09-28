import { initializeAuth } from "@reactive-resume/auth/config";
import { getPool } from "@reactive-resume/db/client";
import { env } from "@reactive-resume/env/server";
import { runDatabaseMigrations } from "./startup/checks";

if (process.env.VERCEL_ENV === "preview" && process.env.ALLOW_PREVIEW_MIGRATIONS !== "true") {
	throw new Error(
		"Preview deployment needs an isolated database. Set ALLOW_PREVIEW_MIGRATIONS=true only after connecting one.",
	);
}

if (process.env.VERCEL === "1") {
	if (env.STORAGE_BACKEND !== "blob")
		throw new Error("Vercel requires private Blob storage for direct uploads. Docker supports local, S3, and Blob.");
	if (!env.REDIS_URL || !env.ENCRYPTION_SECRET) throw new Error("Vercel requires Redis and ENCRYPTION_SECRET.");
}
await runDatabaseMigrations();

await initializeAuth();
await getPool().end();
