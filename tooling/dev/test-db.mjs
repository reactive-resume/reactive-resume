import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { Pool } from "pg";

// Disposable, migrated databases for the real-database Vitest suites, named after this checkout so that
// worktrees sharing the local compose PostgreSQL never share data. Mirrors the CI unit job's setup.
export const root = resolve(import.meta.dirname, "../..");
const slug = basename(root)
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "_")
	.replace(/^_+|_+$/g, "")
	.slice(0, 36);
// The path hash keeps same-named checkouts on separate databases, so `down` in one never drops another's.
export const checkout = `${slug}_${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;

const adminUrl = new URL(process.env.TEST_DB_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres");
if (!["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname)) {
	throw new Error(`Test databases must live on a local PostgreSQL server, not ${adminUrl.hostname}.`);
}

export const databaseName = (purpose) => `rr_${checkout}_${purpose}`;

export function databaseUrl(name) {
	const url = new URL(adminUrl);
	url.pathname = `/${name}`;
	return url.href;
}

async function withAdmin(callback) {
	const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
	try {
		return await callback(admin);
	} finally {
		await admin.end();
	}
}

// Creates any missing database, then applies pending migrations to each one through Drizzle Kit, like `pnpm db:migrate`.
export async function ensureDatabases(names) {
	await withAdmin(async (admin) => {
		const { rows } = await admin.query("SELECT datname FROM pg_database WHERE datname = ANY($1)", [names]);
		for (const name of names) {
			if (!rows.some((row) => row.datname === name)) await admin.query(`CREATE DATABASE "${name}"`);
		}
	});
	for (const name of names) {
		console.error(`\nMigrating ${name}…`);
		// Drizzle Kit's progress goes to stderr, so `env` and `exec` keep stdout for the caller.
		execFileSync("pnpm", ["--silent", "--filter", "@reactive-resume/db", "db:migrate"], {
			cwd: root,
			env: { ...process.env, DATABASE_URL: databaseUrl(name) },
			stdio: ["ignore", 2, 2],
		});
	}
}

// The public fixtures the CI test job sets for every suite (.github/workflows/ci.yml). Some unit suites need the
// secrets or the unsafe AI base URL flag, so the URLs alone aren't enough.
export const ciEnv = {
	AUTH_SECRET: "isolated-ci-auth-secret-32-characters",
	ENCRYPTION_SECRET: "isolated-ci-encryption-secret-32-characters",
	FLAG_DISABLE_SIGNUPS: "false",
	FLAG_DISABLE_EMAIL_AUTH: "false",
	FLAG_ENABLE_GUEST_LOGIN: "true",
	FLAG_DISABLE_API_RATE_LIMIT: "true",
	FLAG_ALLOW_UNSAFE_AI_BASE_URL: "true",
};

const unitDatabases = [databaseName("test"), databaseName("oauth_test")];
const [testUrl, oauthUrl] = unitDatabases.map(databaseUrl);
const unitEnv = {
	...ciEnv,
	DATABASE_URL: testUrl,
	COVER_LETTER_TEST_DATABASE_URL: testUrl,
	INTEGRATIONS_TEST_DATABASE_URL: testUrl,
	// The OAuth suites write signing keys, so they get a database of their own.
	OAUTH_TEST_DATABASE_URL: oauthUrl,
	REQUIRE_DB_TESTS: "1",
};

async function main([command, ...rest]) {
	switch (command) {
		case "up":
			await ensureDatabases(unitDatabases);
			console.error(`\nReady: ${unitDatabases.join(", ")}. Run tests with \`pnpm test:db exec -- <command>\`.`);
			return 0;
		case "env":
			for (const [key, value] of Object.entries(unitEnv)) console.log(`export ${key}='${value}'`);
			return 0;
		case "exec": {
			const [program, ...args] = rest[0] === "--" ? rest.slice(1) : rest;
			if (!program) break;
			// Always migrate: a checkout that pulled new migrations would otherwise test against a stale schema.
			await ensureDatabases(unitDatabases);
			const result = spawnSync(program, args, { stdio: "inherit", env: { ...process.env, ...unitEnv } });
			if (result.error) throw result.error;
			return result.status ?? 1;
		}
		case "down":
			await withAdmin(async (admin) => {
				for (const name of [...unitDatabases, databaseName("e2e")]) {
					await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
				}
			});
			console.error(`Dropped the test databases for ${checkout}.`);
			return 0;
	}
	console.error(
		"Usage: pnpm test:db <up | env | exec -- <command...> | down>\n" +
			"  up    create this checkout's test databases and apply migrations\n" +
			"  env   print export lines for the test databases and the CI test fixtures\n" +
			"  exec  run up, then a command with those variables set\n" +
			"  down  drop this checkout's test and e2e databases",
	);
	return 1;
}

if (process.argv[1] === import.meta.filename) process.exitCode = await main(process.argv.slice(2));
