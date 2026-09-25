import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@reactive-resume/env/server";

declare global {
	var __pool: Pool | undefined;
	var __drizzle: ReturnType<typeof drizzle> | undefined;
}

export function getPool() {
	if (!globalThis.__pool) {
		const pool = new Pool({
			connectionString: env.DATABASE_URL,
			max: env.DATABASE_POOL_MAX,
			connectionTimeoutMillis: 10_000,
			idleTimeoutMillis: 10_000,
		});
		const logPgError = (error: unknown) => {
			console.error("[db] postgres connection error:", error);
		};
		// A Postgres connection can drop at any time — e.g. a serverless Postgres such as Neon
		// terminating the connection (code 57P01). `pg` surfaces this as an 'error' event, and
		// without a listener node re-throws it as an unhandled 'error' that crashes the process.
		// Idle clients emit on the pool; a client that is connecting or checked out emits on the
		// client itself, so we must listen on both. The pool then discards the dead client and
		// opens a fresh one on the next query.
		pool.on("error", logPgError);
		pool.on("connect", (client) => {
			client.on("error", logPgError);
		});
		globalThis.__pool = pool;
	}
	return globalThis.__pool;
}

// ponytail: two private fns collapsed; getPool() is already a singleton, global cache preserved
globalThis.__drizzle ??= drizzle({ client: getPool() });
export const db = globalThis.__drizzle;
