import { constants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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

// A rolling deploy migrates while the previous release still serves traffic. Postgres can then abort the migration
// with a deadlock, or stop waiting at lock_timeout; the whole migration transaction rolls back, so it can run again.
const LOCK_CONFLICT_CODES = new Set(["40P01", "55P03"]); // deadlock_detected, lock_not_available
const MIGRATION_ATTEMPTS = 8;

function lockConflictCode(error: unknown): string | undefined {
	// Drizzle wraps the driver error in `cause`.
	for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string" && LOCK_CONFLICT_CODES.has(code)) return code;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

export async function runDatabaseMigrations() {
	console.info("Running database migrations...");

	const pool = new Pool({
		connectionString: env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL,
		max: 1,
		connectionTimeoutMillis: 10_000,
	});

	try {
		const client = await pool.connect();
		try {
			await client.query("SELECT pg_advisory_lock(721830451)");
			// A waiting ALTER queues every later query on its table, so give up quickly and retry instead.
			await client.query("SET lock_timeout = '5s'");
			const db = drizzle({ client });
			for (let attempt = 1; ; attempt += 1) {
				try {
					await migrate(db, { migrationsFolder: resolveWorkspaceFolder("migrations") });
					console.info("Database migrations completed");
					break;
				} catch (error) {
					const code = lockConflictCode(error);
					if (!code || attempt === MIGRATION_ATTEMPTS) {
						console.error("Database migrations failed", { error });
						throw error;
					}
					const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
					console.warn(
						`Database migrations hit a lock conflict (${code}); retrying in ${delay} ms (attempt ${attempt} of ${MIGRATION_ATTEMPTS}).`,
					);
					await sleep(delay);
				}
			}
			await client.query("RESET lock_timeout");

			// Post-migration verification is not a migration failure, so it gets its own log
			// message. A drifted schema still lets the server boot; STRICT_SCHEMA_CHECK=true
			// makes the drift fatal instead.
			try {
				await verifyMigratedSchema(client);
			} catch (error) {
				console.error("Database schema verification failed", { error });
				if (env.STRICT_SCHEMA_CHECK) throw error;
				console.error(
					"Continuing with a drifted database schema; set STRICT_SCHEMA_CHECK=true to refuse startup instead.",
				);
			}
		} finally {
			try {
				await client.query("SELECT pg_advisory_unlock(721830451)");
			} finally {
				client.release();
			}
		}
	} finally {
		await pool.end();
	}
}

async function validateLocalStoragePath() {
	if (env.STORAGE_BACKEND !== "local") return;

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
