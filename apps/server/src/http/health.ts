import { sql } from "drizzle-orm";
import { withTimeout } from "es-toolkit";
import { getStorageService } from "@reactive-resume/api/features/storage";
import { db } from "@reactive-resume/db/client";
import { getRedis } from "@reactive-resume/db/redis";
import { appVersion } from "../app-version";

const HEALTHCHECK_TIMEOUT_MS = 1_500;

type CheckResult = {
	status: "healthy" | "unhealthy";
	latencyMs: number;
	error?: string;
	[key: string]: unknown;
};

// ponytail: es-toolkit withTimeout takes a fn, not a promise — call site passes check (not check())
async function runCheck(check: () => Promise<object>): Promise<CheckResult> {
	const startedAt = performance.now();

	try {
		const data = await withTimeout(check, HEALTHCHECK_TIMEOUT_MS);
		const latencyMs = Math.round(performance.now() - startedAt);
		const result = data as { status?: string };
		if (result.status === "unhealthy") return { ...(data as object), status: "unhealthy", latencyMs };
		return { ...(data as object), status: "healthy", latencyMs };
	} catch (error) {
		return {
			status: "unhealthy",
			error: error instanceof Error ? error.message : "Unknown error",
			latencyMs: Math.round(performance.now() - startedAt),
		};
	}
}

function publicCheck(check: CheckResult, name: "Database" | "Storage" | "Redis"): CheckResult {
	if (check.status === "healthy") return check;
	return {
		status: check.status,
		latencyMs: check.latencyMs,
		error: `${name} health check failed.`,
		...(check.type === "local" || check.type === "s3" || check.type === "blob" ? { type: check.type } : {}),
	};
}

// ponytail: inner try/catches removed; runCheck's outer catch handles all errors
async function checkDatabase() {
	await db.execute(sql`SELECT 1`);
	return { status: "healthy" };
}

const checkStorage = () => getStorageService().healthcheck();

export async function handleHealth() {
	const redisClient = getRedis();
	const [database, storage, redis] = await Promise.all([
		runCheck(checkDatabase),
		runCheck(checkStorage),
		redisClient
			? runCheck(async () => {
					await redisClient.ping();
					return { status: "healthy" };
				})
			: undefined,
	]);
	const status = [database, storage, redis].some((check) => check?.status === "unhealthy") ? "unhealthy" : "healthy";

	const checks = {
		service: "reactive-resume",
		version: appVersion,
		status,
		timestamp: new Date().toISOString(),
		uptime: `${process.uptime().toFixed(2)}s`,
		database: publicCheck(database, "Database"),
		storage: publicCheck(storage, "Storage"),
		...(redis ? { redis: publicCheck(redis, "Redis") } : {}),
	};

	if (status === "unhealthy") {
		console.warn("[Healthcheck]", { route: "/api/health", database, storage });
	}

	const headers = new Headers();
	const body = JSON.stringify(checks);
	headers.set("Content-Type", "application/json; charset=UTF-8");
	headers.set("Content-Length", Buffer.byteLength(body, "utf-8").toString());

	return new Response(body, {
		headers,
		status: checks.status === "unhealthy" ? 503 : 200,
	});
}
