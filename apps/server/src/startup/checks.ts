import { constants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { env } from "@reactive-resume/env/server";
import { getLocalDataDirectory } from "@reactive-resume/utils/monorepo.node";
import { verifyMigratedSchema } from "./schema-check";

function resolveFromCurrentModule(relativePath: string) {
	return fileURLToPath(new URL(relativePath, import.meta.url));
}

function resolveWorkspaceFolder(folderName: string): string {
	let dir = resolveFromCurrentModule(".");

	while (dir !== path.dirname(dir)) {
		const candidate = path.join(dir, folderName);
		if (existsSync(candidate)) return candidate;
		dir = path.dirname(dir);
	}

	throw new Error(`Could not locate ${folderName} folder relative to ${resolveFromCurrentModule(".")}`);
}

async function runDatabaseMigrations() {
	console.info("Running database migrations...");

	const pool = new Pool({ connectionString: env.DATABASE_URL });
	const db = drizzle({ client: pool });

	try {
		try {
			await migrate(db, { migrationsFolder: resolveWorkspaceFolder("migrations") });
			console.info("Database migrations completed");
		} catch (error) {
			console.error("Database migrations failed", { error });
			throw error;
		}

		// Post-migration verification is not a migration failure, so it gets its own log
		// message. A drifted schema still lets the server boot; STRICT_SCHEMA_CHECK=true
		// makes the drift fatal instead.
		try {
			await verifyMigratedSchema(pool);
		} catch (error) {
			console.error("Database schema verification failed", { error });
			if (env.STRICT_SCHEMA_CHECK) throw error;
			console.error(
				"Continuing with a drifted database schema; set STRICT_SCHEMA_CHECK=true to refuse startup instead.",
			);
		}
	} finally {
		await pool.end();
	}
}

async function validateLocalStoragePath() {
	if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET) return;

	const dataDirectory = getLocalDataDirectory(env.LOCAL_STORAGE_PATH);
	console.info(`Validating local storage path: ${dataDirectory}`);

	try {
		await fs.mkdir(dataDirectory, { recursive: true });
		await fs.access(dataDirectory, constants.R_OK | constants.W_OK);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		console.error(
			`Local storage path is not writable: ${dataDirectory}\n` +
				`  ${message}\n` +
				"Set LOCAL_STORAGE_PATH to a writable directory or fix permissions on the existing path.",
		);
		throw error;
	}
}

async function reapStaleAgentRuns() {
	try {
		const { reapStaleAgentRunsAtBoot } = await import("@reactive-resume/api/features/agent/runs");
		await reapStaleAgentRunsAtBoot();
	} catch (error) {
		// A reap failure must not block serving traffic; stuck runs also heal lazily on access.
		console.error("Failed to reap stale agent runs at boot", { error });
	}
}

export async function runStartupChecks() {
	await runDatabaseMigrations();
	await validateLocalStoragePath();
	await reapStaleAgentRuns();
}
